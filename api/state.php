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

        if (isset($payload['action']) && $payload['action'] === 'restoreQuarantined') {
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