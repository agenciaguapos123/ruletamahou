<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

class UserFactory extends Factory
{
    /**
     * The number of models created till now.
     *
     * @var integer
     */
    protected $index = 0;

    /**
     * Define the model's default state.
     *
     * @return array
     */
    public function definition()
    {
        $this->index++;
        $email = "promo".$this->index."@agenciaguapos.com";
        return [
            'name' => $this->faker->name(),
            'email' => $email,
            'email_verified_at' => now(),
            'password' => bcrypt('password'),
            'remember_token' => Str::random(10),
            'tipo_usuario' => ($this->index == 1)
        ];
    }

    /**
     * Indicate that the model's email address should be unverified.
     *
     * @return \Illuminate\Database\Eloquent\Factories\Factory
     */
    public function unverified()
    {
        return $this->state(function (array $attributes) {
            return [
                'email_verified_at' => null,
            ];
        });
    }
}
