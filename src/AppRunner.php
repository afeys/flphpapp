<?php
namespace FL;
class AppRunner
{
    const NOASSETLOAD = "no-asset-load";
    public function __construct($configPath, $flags = array())  {
        self::init($configPath);
        AppSecurity::preBootCheck($configPath, $flags);
    }

    public static function init($configPath) {
        AppConfig::loadConfig($configPath);
    }
    public static function run($view = "") {
//        echo "<pre>";
//        print_r(AppConfig::getConfig());
//        echo "</pre>";
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