<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddColumnUbicacionIdToPremiosTable extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::table('premios', function (Blueprint $table) {
            $table->foreignId('ubicacion_id')
                ->nullable()
                ->constrained('ubicaciones')
                ->onDelete('no action')
                ->onUpdate('no action');
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::table('premios', function (Blueprint $table) {
            $table->removeColumn('ubicacion_id');
        });
    }
}
