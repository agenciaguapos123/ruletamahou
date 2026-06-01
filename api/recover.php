<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

@ini_set('memory_limit', '512M');
@set_time_limit(120);

function list_quarantined_database_groups(string $databasePath): array
{
    $directory = dirname($databasePath);
    $baseName = basename($databasePath);
    $patterns = [
        $directory . DIRECTORY_SEPARATOR . $baseName . '.corrupt-*',
        $directory . DIRECTORY_SEPARATOR . $baseName . '-wal.corrupt-*',
        $directory . DIRECTORY_SEPARATOR . $baseName . '-shm.corrupt-*',
        $directory . DIRECTORY_SEPARATOR . $baseName . '-journal.corrupt-*',
    ];

    $groups = [];

    foreach ($patterns as $pattern) {
        $matches = glob($pattern);

        if ($matches === false) {
            continue;
        }

        foreach ($matches as $match) {
            $fileName = basename($match);
            $prefix = $baseName;
            $artifact = 'base';

            foreach (['wal', 'shm', 'journal'] as $suffix) {
                $candidatePrefix = $baseName . '-' . $suffix;

                if (strpos($fileName, $candidatePrefix . '.corrupt-') === 0) {
                    $prefix = $candidatePrefix;
                    $artifact = $suffix;
                    break;
                }
            }

            $groupId = substr($fileName, strlen($prefix . '.corrupt-'));

            if ($groupId === false || $groupId === '') {
                continue;
            }

            if (!isset($groups[$groupId])) {
                $groups[$groupId] = [
                    'id' => $groupId,
                    'base' => null,
                    'wal' => null,
                    'shm' => null,
                    'journal' => null,
                ];
            }

            $groups[$groupId][$artifact] = $match;
        }
    }

    $groups = array_values(array_filter($groups, static function (array $group): bool {
        return is_string($group['base']) && $group['base'] !== '';
    }));

    usort($groups, static function (array $left, array $right): int {
        return strcmp($right['id'], $left['id']);
    });

    return $groups;
}

function ensure_recovery_directory(string $directoryPath): void
{
    if (!is_dir($directoryPath) && !mkdir($directoryPath, 0775, true) && !is_dir($directoryPath)) {
        throw new RuntimeException('No se pudo crear el directorio temporal de recuperacion.');
    }
}

function cleanup_recovery_directory(string $directoryPath): void
{
    if (!is_dir($directoryPath)) {
        return;
    }

    $entries = scandir($directoryPath);

    if ($entries === false) {
        return;
    }

    foreach ($entries as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }

        $entryPath = $directoryPath . DIRECTORY_SEPARATOR . $entry;

        if (is_dir($entryPath)) {
            cleanup_recovery_directory($entryPath);
            continue;
        }

        @unlink($entryPath);
    }

    @rmdir($directoryPath);
}

function copy_recovery_artifact(?string $sourcePath, string $targetPath): void
{
    if (!is_string($sourcePath) || $sourcePath === '' || !file_exists($sourcePath)) {
        return;
    }

    if (!copy($sourcePath, $targetPath)) {
        throw new RuntimeException('No se pudo copiar un artefacto de recuperacion.');
    }
}

function decode_state_json(?string $stateJson): ?array
{
    if (!is_string($stateJson) || $stateJson === '') {
        return null;
    }

    $decoded = json_decode($stateJson, true);

    if (!is_array($decoded)) {
        return null;
    }

    return normalize_state($decoded);
}

function extract_state_from_database_file(string $databasePath): ?array
{
    $pdo = new PDO('sqlite:' . $databasePath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $statement = $pdo->query('SELECT state_json FROM app_state WHERE id = 1 LIMIT 1');
    $row = $statement !== false ? $statement->fetch() : false;

    if (!is_array($row) || !isset($row['state_json'])) {
        return null;
    }

    return decode_state_json((string)$row['state_json']);
}

function get_sqlite_binary_path(): ?string
{
    if (!function_exists('shell_exec')) {
        return null;
    }

    $binaryPath = @shell_exec('command -v sqlite3 2>/dev/null');
    $binaryPath = is_string($binaryPath) ? trim($binaryPath) : '';

    return $binaryPath !== '' ? $binaryPath : null;
}

function recover_state_with_sqlite_binary(string $databasePath, string $workingDirectory): ?array
{
    $sqliteBinary = get_sqlite_binary_path();

    if ($sqliteBinary === null) {
        return null;
    }

    $recoveredPath = $workingDirectory . DIRECTORY_SEPARATOR . 'recovered.sqlite';
    $command = $sqliteBinary
        . ' ' . escapeshellarg($databasePath)
        . ' ".recover" 2>/dev/null | '
        . $sqliteBinary . ' ' . escapeshellarg($recoveredPath)
        . ' 2>/dev/null';

    @shell_exec('/bin/sh -lc ' . escapeshellarg($command));

    if (!file_exists($recoveredPath)) {
        return null;
    }

    return extract_state_from_database_file($recoveredPath);
}

function backup_active_database_before_restore(string $databasePath): void
{
    $timestamp = gmdate('Ymd-His');

    foreach ([$databasePath, $databasePath . '-wal', $databasePath . '-shm', $databasePath . '-journal'] as $artifactPath) {
        if (!file_exists($artifactPath)) {
            continue;
        }

        $backupPath = $artifactPath . '.pre-restore-' . $timestamp;

        if (!copy($artifactPath, $backupPath)) {
            throw new RuntimeException('No se pudo guardar una copia de seguridad antes de restaurar.');
        }
    }
}

function summarize_state(array $state): array
{
    return [
        'users' => isset($state['users']) && is_array($state['users']) ? count($state['users']) : 0,
        'locations' => isset($state['locations']) && is_array($state['locations']) ? count($state['locations']) : 0,
        'islands' => isset($state['islands']) && is_array($state['islands']) ? count($state['islands']) : 0,
        'prizeCategories' => isset($state['prizeCategories']) && is_array($state['prizeCategories']) ? count($state['prizeCategories']) : 0,
        'campaigns' => isset($state['campaigns']) && is_array($state['campaigns']) ? count($state['campaigns']) : 0,
        'sessions' => isset($state['sessions']) && is_array($state['sessions']) ? count($state['sessions']) : 0,
    ];
}

function restore_quarantined_group(array $group, string $databasePath): array
{
    $workingDirectory = dirname($databasePath) . DIRECTORY_SEPARATOR . 'recovery-' . uniqid('', true);
    ensure_recovery_directory($workingDirectory);

    try {
        $workingDatabasePath = $workingDirectory . DIRECTORY_SEPARATOR . 'candidate.sqlite';
        copy_recovery_artifact($group['base'], $workingDatabasePath);
        copy_recovery_artifact($group['wal'], $workingDatabasePath . '-wal');
        copy_recovery_artifact($group['shm'], $workingDatabasePath . '-shm');
        copy_recovery_artifact($group['journal'], $workingDatabasePath . '-journal');

        $recoveredState = null;

        try {
            $recoveredState = extract_state_from_database_file($workingDatabasePath);
        } catch (Throwable $exception) {
            $recoveredState = null;
        }

        if ($recoveredState === null) {
            try {
                $recoveredState = recover_state_with_sqlite_binary($workingDatabasePath, $workingDirectory);
            } catch (Throwable $exception) {
                $recoveredState = null;
            }
        }

        if ($recoveredState === null) {
            try {
                $recoveredState = recover_state_from_raw_database_file($workingDatabasePath);
            } catch (Throwable $exception) {
                $recoveredState = null;
            }
        }

        if ($recoveredState === null) {
            throw new RuntimeException('No se pudo extraer un estado valido desde la copia cuarentenada.');
        }

        backup_active_database_before_restore($databasePath);
        $pdo = open_database();
        save_state($pdo, $recoveredState);

        return $recoveredState;
    } finally {
        cleanup_recovery_directory($workingDirectory);
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    method_not_allowed('POST');
}

try {
    $database = open_database_with_state();
    $state = $database['state'];
    $user = require_authenticated_user($state);

    if (($user['role'] ?? '') !== 'admin') {
        json_response(['message' => 'Solo el administrador puede restaurar copias antiguas.'], 403);
    }

    $payload = read_json_input();
    $action = isset($payload['action']) ? (string)$payload['action'] : 'restoreLatest';
    $databasePath = get_database_path();
    $groups = list_quarantined_database_groups($databasePath);

    if ($action === 'list') {
        json_response([
            'groups' => array_map(static function (array $group): array {
                return [
                    'id' => $group['id'],
                    'hasWal' => is_string($group['wal']) && $group['wal'] !== '',
                    'hasShm' => is_string($group['shm']) && $group['shm'] !== '',
                    'hasJournal' => is_string($group['journal']) && $group['journal'] !== '',
                ];
            }, $groups),
        ]);
    }

    if (!$groups) {
        json_response(['message' => 'No hay copias cuarentenadas disponibles para restaurar.'], 404);
    }

    $requestedGroupId = isset($payload['groupId']) ? (string)$payload['groupId'] : null;
    $selectedGroup = null;

    if ($requestedGroupId !== null && $requestedGroupId !== '') {
        foreach ($groups as $group) {
            if ($group['id'] === $requestedGroupId) {
                $selectedGroup = $group;
                break;
            }
        }

        if ($selectedGroup === null) {
            json_response(['message' => 'La copia solicitada no existe.'], 404);
        }
    } else {
        $selectedGroup = $groups[0];
    }

    $restoredState = restore_quarantined_group($selectedGroup, $databasePath);

    json_response([
        'restored' => true,
        'groupId' => $selectedGroup['id'],
        'summary' => summarize_state($restoredState),
    ]);
} catch (Throwable $exception) {
    json_response(['message' => 'No se pudo restaurar la copia antigua.'], 500);
}