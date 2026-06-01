<?php
declare(strict_types=1);

session_start();

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');

    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if ($json === false) {
        echo '{"message":"No se pudo generar la respuesta JSON."}';
        exit;
    }

    echo $json;
    exit;
}

function method_not_allowed(string $allowed): void
{
    header('Allow: ' . $allowed);
    json_response(['message' => 'Metodo no permitido.'], 405);
}

function read_json_input(): array
{
    $rawBody = file_get_contents('php://input');

    if ($rawBody === false || trim($rawBody) === '') {
        return [];
    }

    $decoded = json_decode($rawBody, true);

    if (!is_array($decoded)) {
        json_response(['message' => 'JSON no valido.'], 400);
    }

    return $decoded;
}

function get_database_path(): string
{
    $customPath = getenv('RULETA_DB_PATH');

    if (is_string($customPath) && trim($customPath) !== '') {
        return $customPath;
    }

    return dirname(__DIR__, 3) . DIRECTORY_SEPARATOR . 'ruleta-data' . DIRECTORY_SEPARATOR . 'app-state.sqlite';
}

function open_database(): PDO
{
    $databasePath = get_database_path();
    $databaseDirectory = dirname($databasePath);

    if (!is_dir($databaseDirectory) && !mkdir($databaseDirectory, 0775, true) && !is_dir($databaseDirectory)) {
        throw new RuntimeException('No se pudo crear el directorio de la base de datos.');
    }

    $pdo = new PDO('sqlite:' . $databasePath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    ensure_schema($pdo);

    return $pdo;
}

function is_malformed_database_exception(Throwable $exception): bool
{
    return $exception instanceof PDOException
        && stripos($exception->getMessage(), 'database disk image is malformed') !== false;
}

function quarantine_database_artifact(string $artifactPath, string $timestamp): void
{
    if (!file_exists($artifactPath)) {
        return;
    }

    $backupPath = $artifactPath . '.corrupt-' . $timestamp;
    $attempt = 1;

    while (file_exists($backupPath)) {
        $backupPath = $artifactPath . '.corrupt-' . $timestamp . '-' . $attempt;
        $attempt += 1;
    }

    if (!rename($artifactPath, $backupPath)) {
        throw new RuntimeException('No se pudo aislar la base de datos dañada.');
    }
}

function quarantine_malformed_database(string $databasePath): void
{
    $timestamp = gmdate('Ymd-His');

    foreach ([$databasePath, $databasePath . '-wal', $databasePath . '-shm', $databasePath . '-journal'] as $artifactPath) {
        quarantine_database_artifact($artifactPath, $timestamp);
    }
}

function archive_database_artifact(string $artifactPath, string $label, string $timestamp): void
{
    if (!file_exists($artifactPath)) {
        return;
    }

    $backupPath = $artifactPath . '.' . $label . '-' . $timestamp;
    $attempt = 1;

    while (file_exists($backupPath)) {
        $backupPath = $artifactPath . '.' . $label . '-' . $timestamp . '-' . $attempt;
        $attempt += 1;
    }

    if (!rename($artifactPath, $backupPath)) {
        throw new RuntimeException('No se pudo archivar la base de datos activa.');
    }
}

function archive_database_artifacts(string $databasePath, string $label): void
{
    $timestamp = gmdate('Ymd-His');

    foreach ([$databasePath, $databasePath . '-wal', $databasePath . '-shm', $databasePath . '-journal'] as $artifactPath) {
        archive_database_artifact($artifactPath, $label, $timestamp);
    }
}

function list_quarantined_database_paths(string $databasePath): array
{
    $matches = glob($databasePath . '.corrupt-*');

    if (!is_array($matches)) {
        return [];
    }

    $files = array_values(array_filter($matches, 'is_file'));

    usort(
        $files,
        static function (string $left, string $right): int {
            $leftModifiedAt = filemtime($left) ?: 0;
            $rightModifiedAt = filemtime($right) ?: 0;

            if ($leftModifiedAt === $rightModifiedAt) {
                return strcmp($right, $left);
            }

            return $rightModifiedAt <=> $leftModifiedAt;
        }
    );

    return $files;
}

function decode_state_payload(string $encodedState): array
{
    $decoded = json_decode($encodedState, true);

    if (!is_array($decoded)) {
        throw new RuntimeException('La copia recuperada no contiene un estado valido.');
    }

    return normalize_state($decoded);
}

function load_state_from_database_file(string $databasePath): array
{
    $pdo = new PDO('sqlite:' . $databasePath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $statement = $pdo->query('SELECT state_json FROM app_state WHERE id = 1 LIMIT 1');
    $row = $statement !== false ? $statement->fetch() : false;

    if (!is_array($row) || !isset($row['state_json'])) {
        throw new RuntimeException('La copia antigua no contiene estado guardado.');
    }

    return decode_state_payload((string)$row['state_json']);
}

function split_sql_value_list(string $valuesSql): array
{
    $parts = preg_split("/,(?=(?:[^']*'[^']*')*[^']*$)/", $valuesSql);

    return is_array($parts) ? array_map('trim', $parts) : [];
}

function unquote_sqlite_value(string $value): string
{
    $trimmedValue = trim($value);

    if (strlen($trimmedValue) >= 2 && $trimmedValue[0] === "'" && substr($trimmedValue, -1) === "'") {
        $trimmedValue = substr($trimmedValue, 1, -1);
    }

    return str_replace("''", "'", $trimmedValue);
}

function recover_state_from_sqlite_dump(string $dump): array
{
    if (
        preg_match('/INSERT INTO\s+app_state(?:\(([^)]*)\))?\s+VALUES\s*\((.+?)\);/s', $dump, $matches) !== 1
    ) {
        throw new RuntimeException('sqlite3 no encontro una fila valida en app_state.');
    }

    $columnNames = isset($matches[1]) && trim($matches[1]) !== ''
        ? array_map('trim', explode(',', $matches[1]))
        : [];
    $values = split_sql_value_list($matches[2]);
    $stateJsonIndex = 1;

    if ($columnNames) {
        $stateJsonIndex = array_search('state_json', $columnNames, true);

        if ($stateJsonIndex === false) {
            throw new RuntimeException('sqlite3 recupero la fila pero no encontro state_json.');
        }
    }

    if (!isset($values[$stateJsonIndex])) {
        throw new RuntimeException('sqlite3 recupero la fila con columnas incompletas.');
    }

    return decode_state_payload(unquote_sqlite_value($values[$stateJsonIndex]));
}

function find_sqlite_cli_binary(): ?string
{
    if (!function_exists('shell_exec')) {
        return null;
    }

    $output = shell_exec('command -v sqlite3 2>/dev/null || which sqlite3 2>/dev/null');

    if (!is_string($output) || trim($output) === '') {
        return null;
    }

    $lines = preg_split('/\r?\n/', trim($output));

    return is_array($lines) && isset($lines[0]) && trim($lines[0]) !== '' ? trim($lines[0]) : null;
}

function recover_state_with_sqlite_cli(string $databasePath): array
{
    $sqliteBinary = find_sqlite_cli_binary();

    if ($sqliteBinary === null) {
        throw new RuntimeException('sqlite3 no esta disponible en el servidor para recuperar la copia dañada.');
    }

    $sqliteBinaryCommand = escapeshellcmd($sqliteBinary);
    $readCommand = $sqliteBinaryCommand . ' ' . escapeshellarg($databasePath) . ' "SELECT state_json FROM app_state WHERE id = 1 LIMIT 1;" 2>/dev/null';
    $readOutput = shell_exec($readCommand);

    if (is_string($readOutput) && trim($readOutput) !== '') {
        try {
            return decode_state_payload(trim($readOutput));
        } catch (Throwable $exception) {
        }
    }

    $recoverCommand = $sqliteBinaryCommand . ' ' . escapeshellarg($databasePath) . ' ".recover" 2>/dev/null';
    $recoverOutput = shell_exec($recoverCommand);

    if (!is_string($recoverOutput) || trim($recoverOutput) === '') {
        throw new RuntimeException('sqlite3 no pudo extraer datos de la copia dañada.');
    }

    return recover_state_from_sqlite_dump($recoverOutput);
}

function recover_state_from_raw_database_file(string $databasePath): array
{
    $rawContents = file_get_contents($databasePath);

    if (!is_string($rawContents) || $rawContents === '') {
        throw new RuntimeException('No se pudo leer la copia dañada para extraer el estado en bruto.');
    }

    $startNeedle = '{"users":';
    $sessionsNeedle = ',"sessions":';
    $searchOffset = 0;

    while (($startPosition = strpos($rawContents, $startNeedle, $searchOffset)) !== false) {
        $sessionsPosition = strpos($rawContents, $sessionsNeedle, $startPosition);

        if ($sessionsPosition === false) {
            break;
        }

        $endSearchOffset = $sessionsPosition;

        while (($endPosition = strpos($rawContents, ']}' , $endSearchOffset)) !== false) {
            $candidate = substr($rawContents, $startPosition, $endPosition + 2 - $startPosition);

            try {
                return decode_state_payload($candidate);
            } catch (Throwable $exception) {
                $endSearchOffset = $endPosition + 2;
            }
        }

        $searchOffset = $startPosition + 1;
    }

    throw new RuntimeException('No se encontro un estado JSON valido dentro de la copia dañada.');
}

function recover_state_from_quarantined_database(string $databasePath): array
{
    try {
        return load_state_from_database_file($databasePath);
    } catch (Throwable $exception) {
        try {
            return recover_state_with_sqlite_cli($databasePath);
        } catch (Throwable $secondException) {
            return recover_state_from_raw_database_file($databasePath);
        }
    }
}

function open_database_with_state(): array
{
    $pdo = open_database();

    try {
        return [
            'pdo' => $pdo,
            'state' => load_state($pdo),
        ];
    } catch (Throwable $exception) {
        if (!is_malformed_database_exception($exception)) {
            throw $exception;
        }

        $databasePath = get_database_path();
        $pdo = null;

        quarantine_malformed_database($databasePath);

        $recoveredPdo = open_database();
        $defaultState = build_default_state();
        save_state($recoveredPdo, $defaultState);

        return [
            'pdo' => $recoveredPdo,
            'state' => $defaultState,
        ];
    }
}

function ensure_schema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS app_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            state_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )'
    );
}

function build_default_state(): array
{
    return [
        'users' => [
            [
                'id' => 'user-admin',
                'username' => 'admin',
                'password' => 'mahou2026',
                'displayName' => 'Administrador Mahou',
                'role' => 'admin',
            ],
            [
                'id' => 'user-operator',
                'username' => 'promotor',
                'password' => 'mahou2026',
                'displayName' => 'Promotor Mahou',
                'role' => 'operator',
            ],
        ],
        'adminAccessCode' => 'mahou-admin',
        'locations' => [
            [
                'id' => 'location-mercado-san-ildefonso',
                'name' => 'Mercado de San Ildefonso',
                'city' => 'Madrid',
                'islandId' => 'island-1',
            ],
            [
                'id' => 'location-la-tape',
                'name' => 'La Tape',
                'city' => 'Madrid',
                'islandId' => 'island-2',
            ],
            [
                'id' => 'location-sala-mon',
                'name' => 'Sala Mon',
                'city' => 'Madrid',
                'islandId' => 'island-2',
            ],
        ],
        'islands' => [
            ['id' => 'island-1', 'name' => 'Isla 1'],
            ['id' => 'island-2', 'name' => 'Isla 2'],
            ['id' => 'island-3', 'name' => 'Isla 3'],
        ],
        'prizeCategories' => [
            [
                'id' => 'category-camiseta-mahou',
                'name' => 'Camiseta Mahou',
                'description' => '',
                'imageSrc' => null,
            ],
            [
                'id' => 'category-pack-consumicion',
                'name' => 'Pack consumicion',
                'description' => 'Solo activo en la franja fuerte del afterwork.',
                'imageSrc' => null,
            ],
            [
                'id' => 'category-abridor-mahou',
                'name' => 'Abridor Mahou',
                'description' => 'Premio always-on para mantener giro constante.',
                'imageSrc' => null,
            ],
            [
                'id' => 'category-entrada-concierto',
                'name' => 'Entrada concierto',
                'description' => 'Se desbloquea solo en la parte final de la ruta.',
                'imageSrc' => null,
            ],
        ],
        'campaigns' => [
            [
                'id' => 'campaign-mahou-tardeo-chamberi',
                'name' => 'Mahou Tardeo Chamberi',
                'type' => 'accion',
                'notes' => 'Activacion de un unico local con foco en captacion y dinamica inmediata.',
                'islandId' => 'island-1',
                'locationIds' => ['location-mercado-san-ildefonso'],
                'status' => 'active',
                'prizeTemplates' => [
                    [
                        'id' => 'prize-mahou-tardeo-camiseta',
                        'categoryId' => 'category-camiseta-mahou',
                        'name' => 'Camiseta Mahou',
                        'description' => '',
                        'imageSrc' => null,
                        'stock' => 20,
                        'isEnabled' => true,
                        'timeMode' => 'always',
                        'windows' => [],
                    ],
                    [
                        'id' => 'prize-mahou-tardeo-pack-consumicion',
                        'categoryId' => 'category-pack-consumicion',
                        'name' => 'Pack consumicion',
                        'description' => 'Solo activo en la franja fuerte del afterwork.',
                        'imageSrc' => null,
                        'stock' => 16,
                        'isEnabled' => true,
                        'timeMode' => 'scheduled',
                        'windows' => [
                            [
                                'id' => 'window-afterwork',
                                'label' => 'Afterwork',
                                'start' => '19:00',
                                'end' => '22:00',
                                'enabled' => true,
                                'quota' => 16,
                                'carryOver' => true,
                            ],
                        ],
                    ],
                ],
            ],
            [
                'id' => 'campaign-ruta-roja-centro',
                'name' => 'Ruta Roja Centro',
                'type' => 'ruta',
                'notes' => 'Ruta multi local para mover publico entre varios puntos de consumo.',
                'islandId' => 'island-2',
                'locationIds' => [
                    'location-la-tape',
                    'location-sala-mon',
                ],
                'status' => 'active',
                'prizeTemplates' => [
                    [
                        'id' => 'prize-ruta-roja-abridor',
                        'categoryId' => 'category-abridor-mahou',
                        'name' => 'Abridor Mahou',
                        'description' => 'Premio always-on para mantener giro constante.',
                        'imageSrc' => null,
                        'stock' => 40,
                        'isEnabled' => true,
                        'timeMode' => 'always',
                        'windows' => [],
                    ],
                    [
                        'id' => 'prize-ruta-roja-entrada-concierto',
                        'categoryId' => 'category-entrada-concierto',
                        'name' => 'Entrada concierto',
                        'description' => 'Se desbloquea solo en la parte final de la ruta.',
                        'imageSrc' => null,
                        'stock' => 10,
                        'isEnabled' => true,
                        'timeMode' => 'scheduled',
                        'windows' => [
                            [
                                'id' => 'window-cierre',
                                'label' => 'Cierre',
                                'start' => '21:30',
                                'end' => '23:30',
                                'enabled' => true,
                                'quota' => 10,
                                'carryOver' => true,
                            ],
                        ],
                    ],
                ],
            ],
        ],
        'sessions' => [],
    ];
}

function first_array_key(array $values): ?string
{
    foreach ($values as $key => $_value) {
        return is_string($key) ? $key : (string)$key;
    }

    return null;
}

function normalize_state(array $state): array
{
    $defaultState = build_default_state();
    $campaigns = isset($state['campaigns']) && is_array($state['campaigns'])
        ? array_values($state['campaigns'])
        : $defaultState['campaigns'];
    $locations = isset($state['locations']) && is_array($state['locations'])
        ? array_values($state['locations'])
        : $defaultState['locations'];

    $locations = array_map(
        static function (array $location) use ($campaigns): array {
            $locationId = isset($location['id']) && is_string($location['id']) ? $location['id'] : null;
            $explicitIslandId = isset($location['islandId']) && is_string($location['islandId'])
                ? $location['islandId']
                : null;

            if ($explicitIslandId !== null || $locationId === null) {
                $location['islandId'] = $explicitIslandId;
                return $location;
            }

            $actionIslandIds = [];
            $allIslandIds = [];

            foreach ($campaigns as $campaign) {
                $campaignLocationIds = isset($campaign['locationIds']) && is_array($campaign['locationIds'])
                    ? $campaign['locationIds']
                    : [];
                $campaignIslandId = isset($campaign['islandId']) && is_string($campaign['islandId'])
                    ? $campaign['islandId']
                    : null;

                if ($campaignIslandId === null || !in_array($locationId, $campaignLocationIds, true)) {
                    continue;
                }

                $allIslandIds[$campaignIslandId] = true;

                if (($campaign['type'] ?? null) === 'accion') {
                    $actionIslandIds[$campaignIslandId] = true;
                }
            }

            if (count($actionIslandIds) === 1) {
                $location['islandId'] = first_array_key($actionIslandIds);
                return $location;
            }

            $location['islandId'] = count($allIslandIds) === 1 ? first_array_key($allIslandIds) : null;
            return $location;
        },
        $locations
    );

    return [
        'users' => isset($state['users']) && is_array($state['users'])
            ? array_values($state['users'])
            : $defaultState['users'],
        'adminAccessCode' => isset($state['adminAccessCode']) && is_string($state['adminAccessCode'])
            ? $state['adminAccessCode']
            : $defaultState['adminAccessCode'],
        'locations' => $locations,
        'islands' => isset($state['islands']) && is_array($state['islands'])
            ? array_values($state['islands'])
            : $defaultState['islands'],
        'prizeCategories' => isset($state['prizeCategories']) && is_array($state['prizeCategories'])
            ? array_values($state['prizeCategories'])
            : $defaultState['prizeCategories'],
        'campaigns' => $campaigns,
        'sessions' => isset($state['sessions']) && is_array($state['sessions'])
            ? array_values($state['sessions'])
            : [],
    ];
}

function load_state(PDO $pdo): array
{
    $statement = $pdo->query('SELECT state_json FROM app_state WHERE id = 1 LIMIT 1');
    $row = $statement !== false ? $statement->fetch() : false;

    if (!is_array($row) || !isset($row['state_json'])) {
        $defaultState = build_default_state();
        save_state($pdo, $defaultState);
        return $defaultState;
    }

    $decoded = json_decode((string)$row['state_json'], true);

    if (!is_array($decoded)) {
        $defaultState = build_default_state();
        save_state($pdo, $defaultState);
        return $defaultState;
    }

    return normalize_state($decoded);
}

function save_state(PDO $pdo, array $state): void
{
    $normalizedState = normalize_state($state);
    $encodedState = json_encode($normalizedState, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if ($encodedState === false) {
        throw new RuntimeException('No se pudo serializar el estado de la aplicacion.');
    }

    $timestamp = gmdate('c');
    $statement = $pdo->prepare(
        'INSERT INTO app_state (id, state_json, created_at, updated_at)
         VALUES (1, :state_json, :created_at, :updated_at)
         ON CONFLICT(id) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at'
    );

    $statement->execute([
        ':state_json' => $encodedState,
        ':created_at' => $timestamp,
        ':updated_at' => $timestamp,
    ]);
}

function find_user_by_credentials(array $state, string $username, string $password): ?array
{
    $normalizedUsername = strtolower(trim($username));

    foreach ($state['users'] as $user) {
        $candidateUsername = isset($user['username']) ? strtolower((string)$user['username']) : '';
        $candidatePassword = isset($user['password']) ? (string)$user['password'] : '';

        if ($candidateUsername === $normalizedUsername && $candidatePassword === $password) {
            return $user;
        }
    }

    return null;
}

function find_user_by_id(array $state, ?string $userId): ?array
{
    if (!$userId) {
        return null;
    }

    foreach ($state['users'] as $user) {
        if (($user['id'] ?? null) === $userId) {
            return $user;
        }
    }

    return null;
}

function current_session_user(array $state): ?array
{
    $userId = isset($_SESSION['user_id']) ? (string)$_SESSION['user_id'] : null;
    return find_user_by_id($state, $userId);
}

function require_authenticated_user(array $state): array
{
    $user = current_session_user($state);

    if ($user === null) {
        json_response(['message' => 'Debes iniciar sesion.'], 401);
    }

    return $user;
}

function clear_session(): void
{
    $_SESSION = [];

    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'] ?? '/',
            $params['domain'] ?? '',
            (bool)($params['secure'] ?? false),
            (bool)($params['httponly'] ?? true)
        );
    }

    session_destroy();
}

function merge_state_for_user(array $currentState, array $incomingState, array $user): array
{
    $normalizedIncoming = normalize_state($incomingState);

    if (($user['role'] ?? '') === 'admin') {
        return $normalizedIncoming;
    }

    $nextState = $currentState;
    $nextState['sessions'] = $normalizedIncoming['sessions'];

    return normalize_state($nextState);
}