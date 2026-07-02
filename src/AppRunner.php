<?php
namespace FL;
class AppRunner
{
    public function __construct($configPath)  {
        self::init($configPath);
        AppSecurity::preBootCheck($configPath);
    }

    public static function init($configPath) {
        AppConfig::loadConfig($configPath);
    }
    public static function run($view = "") {
        echo "<pre>";
        print_r(AppConfig::getConfig());
        echo "</pre>";
        if ($view == "") {
            $view = AppConfig::get("StartView");
        }
        $viewDir = AppConfig::get("ViewDir");
        if ($view !== "") {
            $viewFile = AppConfig::get("BaseDirectory") .  $viewDir . "/" . str_replace('.', '/', $view) . ".php";
            if (file_exists($viewFile)) {
                require_once $viewFile;
            }
        }
    }
}