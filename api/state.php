<?php
declare(strict_types=1);

require __DIR__ . '/lib.php';

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