<?php
namespace FL;
class AppRunner
{
    public static function init($configPath) {
        AppConfig::loadConfig($configPath);
    }
    public static function run() {
        echo "<pre>";
        print_r(AppConfig::getConfig());
        echo "</pre>";
    }
}