<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    method_not_allowed('GET');
}

try {
    $pdo = open_database();
    $state = load_state($pdo);
    $user = current_session_user($state);

    json_response([
        'authenticated' => $user !== null,
        'user' => $user,
        'state' => $user !== null ? $state : null,
    ]);
} catch (Throwable $exception) {
    json_response(['message' => 'No se pudo cargar el estado desde la base de datos.'], 500);
}