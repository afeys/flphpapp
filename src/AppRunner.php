<?php
namespace FL;
class AppRunner
{
    public static function run() {
        echo "<pre>";
        print_r(AppConfig::getConfig());
        echo "</pre>";
    }
}