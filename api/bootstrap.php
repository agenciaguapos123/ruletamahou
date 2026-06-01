<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

function bootstrap_error_payload(Throwable $exception): array
{
    $payload = ['message' => 'No se pudo cargar el estado desde la base de datos.'];

    if (isset($_GET['debug']) && $_GET['debug'] === '1') {
        $payload['debug'] = [
            'type' => get_class($exception),
            'message' => $exception->getMessage(),
        ];
    }

    return $payload;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    method_not_allowed('GET');
}

try {
    $database = open_database_with_state();
    $state = $database['state'];
    $user = current_session_user($state);

    json_response([
        'authenticated' => $user !== null,
        'user' => $user,
        'state' => $user !== null ? $state : null,
    ]);
} catch (Throwable $exception) {
    json_response(bootstrap_error_payload($exception), 500);
}