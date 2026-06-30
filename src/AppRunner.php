<?php
namespace FL;
class AppRunner
{
    public static function init() {
        AppConfig::loadConfig();
    }
    public static function run() {
        echo "<pre>";
        print_r(AppConfig::getConfig());
        echo "</pre>";
    }
}