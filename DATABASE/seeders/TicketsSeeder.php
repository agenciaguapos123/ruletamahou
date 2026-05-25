<?php

namespace Database\Seeders;

use App\Models\Servicio;
use App\Models\Ticket;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class TicketsSeeder extends Seeder
{
    /**
     * Run the database seeds.
     *
     * @return void
     */
    public function run()
    {
        Ticket::create([
            'nombre' => 'X1'
        ]);
        Ticket::create([
            'nombre' => 'X Dos'
        ]);
        Ticket::create([
            'nombre' => 'X3'
        ]);
    }
}
