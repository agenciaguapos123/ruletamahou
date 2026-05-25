<?php

namespace Database\Factories;

use App\Models\Almacen;
use App\Models\Premio;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Factories\Factory;

class PremioFactory extends Factory
{
    /**
     * The name of the factory's corresponding model.
     *
     * @var string
     */
    protected $model = Premio::class;

    /**
     * Define the model's default state.
     *
     * @return array
     */
    public function definition()
    {
        return [
            'nombre' => $this->faker->firstName,
            'cantidad' => $this->faker->numberBetween(10,50),
            'estado' => $this->faker->numberBetween(0,1),
            'tickets_id' => $this->faker->numberBetween(1,3),
            'url_img' => '/images/web/baraja.png'
        ];
    }
}
