<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    method_not_allowed('POST');
}

try {
    $payload = read_json_input();
    $action = isset($payload['action']) ? (string)$payload['action'] : 'login';

    if ($action === 'logout') {
        clear_session();
        json_response(['ok' => true]);
    }

    if ($action !== 'login') {
        json_response(['message' => 'Accion no valida.'], 400);
    }

    $username = isset($payload['username']) ? (string)$payload['username'] : '';
    $password = isset($payload['password']) ? (string)$payload['password'] : '';
    $database = open_database_with_state();
    $state = $database['state'];
    $user = find_user_by_credentials($state, $username, $password);

    if ($user === null) {
        json_response(['message' => 'Usuario o contrasena incorrectos.'], 401);
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = $user['id'];

    json_response([
        'user' => $user,
        'state' => $state,
    ]);
} catch (Throwable $exception) {
    json_response(['message' => 'No se pudo completar la autenticacion.'], 500);
}