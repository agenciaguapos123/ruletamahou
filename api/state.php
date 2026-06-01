<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

register_shutdown_function(static function (): void {
    $error = error_get_last();

    if (!is_array($error)) {
        return;
    }

    if (!in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        return;
    }

    if (headers_sent()) {
        return;
    }

    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'message' => 'Fallo fatal al procesar el estado.',
        'error' => $error['message'],
        'file' => basename((string) ($error['file'] ?? '')),
        'line' => (int) ($error['line'] ?? 0),
    ]);
});

function summarize_recovered_state(array $state): array
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

function inspect_quarantined_state_copy(string $candidatePath): array
{
    $inspectMethod = static function (callable $resolver): array {
        try {
            $state = $resolver();

            if (!is_array($state)) {
                return ['ok' => false, 'error' => 'No devolvio un estado valido.'];
            }

            return ['ok' => true, 'summary' => summarize_recovered_state($state)];
        } catch (Throwable $exception) {
            return ['ok' => false, 'error' => $exception->getMessage()];
        }
    };

    return [
        'file' => basename($candidatePath),
        'size' => is_file($candidatePath) ? filesize($candidatePath) : null,
        'direct' => $inspectMethod(static function () use ($candidatePath): array {
            return load_state_from_database_file($candidatePath);
        }),
        'sqliteCli' => [
            'available' => find_sqlite_cli_binary() !== null,
            'result' => $inspectMethod(static function () use ($candidatePath): array {
                return recover_state_with_sqlite_cli($candidatePath);
            }),
        ],
        'raw' => $inspectMethod(static function () use ($candidatePath): array {
            return recover_state_from_raw_database_file($candidatePath);
        }),
    ];
}

try {
    $database = open_database_with_state();
    $pdo = $database['pdo'];
    $state = $database['state'];
    $user = require_authenticated_user($state);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        json_response(['state' => $state]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $payload = read_json_input();
        $action = isset($payload['action']) ? (string) $payload['action'] : null;

        if ($action === 'inspectQuarantined' || $action === 'restoreQuarantined') {
            if (($user['role'] ?? '') !== 'admin') {
                json_response(['message' => 'Solo el administrador puede restaurar copias antiguas.'], 403);
            }

            @ini_set('memory_limit', '512M');
            @set_time_limit(120);

            $databasePath = get_database_path();
            $candidates = list_quarantined_database_paths($databasePath);

            if (!$candidates) {
                json_response(['message' => 'No se encontraron copias antiguas para restaurar.'], 404);
            }

            if ($action === 'inspectQuarantined') {
                json_response([
                    'candidates' => array_map(static function (string $candidatePath): array {
                        return inspect_quarantined_state_copy($candidatePath);
                    }, $candidates),
                ]);
            }

            $recoveredState = null;
            $recoveredSource = null;
            $errors = [];

            foreach ($candidates as $candidatePath) {
                try {
                    $recoveredState = recover_state_from_quarantined_database($candidatePath);
                    $recoveredSource = basename($candidatePath);
                    break;
                } catch (Throwable $exception) {
                    $errors[] = [
                        'file' => basename($candidatePath),
                        'message' => $exception->getMessage(),
                    ];
                }
            }

            if ($recoveredState === null || $recoveredSource === null) {
                json_response([
                    'message' => 'No se pudo recuperar ninguna copia antigua de la ruleta.',
                    'errors' => $errors,
                ], 500);
            }

            archive_database_artifacts($databasePath, 'pre-restore');
            $restorePdo = open_database();
            save_state($restorePdo, $recoveredState);

            json_response([
                'state' => $recoveredState,
                'restored' => true,
                'source' => $recoveredSource,
                'errors' => $errors,
            ]);
        }

        $incomingState = $payload;

        if (isset($payload['state']) && is_array($payload['state'])) {
            $incomingState = $payload['state'];
        }

        if (!is_array($incomingState)) {
            json_response(['message' => 'El estado enviado no es valido.'], 400);
        }

        $nextState = merge_state_for_user($state, $incomingState, $user);
        save_state($pdo, $nextState);

        json_response(['state' => $nextState]);
    }

    method_not_allowed('GET, POST');
} catch (Throwable $exception) {
    json_response(['message' => 'No se pudo guardar el estado en la base de datos.'], 500);
}