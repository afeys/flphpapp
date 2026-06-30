<?php
namespace Fl;
set_time_limit(0);
date_default_timezone_set('Europe/Brussels');
ini_set('memory_limit', '3072M');
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);
define('APPLICATION_PATH', realpath('./'));
$paths = array(
    APPLICATION_PATH . '/',
    get_include_path(),
);
set_include_path(implode(PATH_SEPARATOR, $paths));

class AppConfig
{
    // loadConfig will overwrite certain values of the static variables with info found in a config.php files. This allows for more flexibility in putting this app live.
    // On the server the file config.php has to be read only to avoid being overwritten when all files are ftp'd to the live server
    public static function loadConfig()
    {
        $configPath = __DIR__ . '/config.php'; // Or config.json
        if (file_exists($configPath)) {
            $config = include $configPath; // Load PHP array config

            foreach ($config as $key => $value) {
                if (property_exists(__CLASS__, $key)) {
                    self::$$key = $value; // Dynamically assign properties
                }
            }

            // making sure that all relevant libraries are loaded
            require_once(AppConfig::get("BaseDirectory") . '/vendor/autoload.php');

            // loading the database connections in the ConnectionManager
            if (Self::keyExists("DBConnections")) {
                // creating the connection manager
                $connmgr = \FL\ConnectionManager::getInstance();
                $connections = AppConfig::get("DBConnections");
                foreach ($connections as $name => $conn) {
                    $host = "";
                    $user = "";
                    $pwd = "";
                    $dbname = "";
                    if (array_key_exists("host", $conn)) {
                        $host = $conn["host"];
                    }
                    if (array_key_exists("user", $conn)) {
                        $user = $conn["user"];
                    }
                    if (array_key_exists("pwd", $conn)) {
                        $host = $conn["pwd"];
                    }
                    if (array_key_exists("dbname", $conn)) {
                        $host = $conn["dbname"];
                    }
                    $connmgr->addConnection(
                            \FL\Connection::getInstance($name, $host, $user, $pwd, $dbname)
                        );
                }
            }

            // loading the model directories
            if (Self::keyExists("DBModelDirs")) {
                foreach( AppConfig::get("DBModelDirs") as $dir)
                \FL\Model::initialize(array(AppConfig::$BaseDirectory .$dir));
            }
        }
    }

    public static function getConfig() {
        $returnvalue = array();
        $reflection = new \ReflectionClass('AppConfig');
        $staticVars = $reflection->getStaticProperties();
        foreach ($staticVars as $name => $value) {
            $returnvalue[$name] = var_export($value, true);
        }
        return $returnvalue;
    }

    public static function get($key) {
        if (property_exists(__CLASS__, $key)) {
            return self::$$key;
        } else {
            throw new Flappy\ConfigException("Config key $key not found");
        }
    }

    public static function keyExists($key) {
        return property_exists(__CLASS__, $key);
    }
}
AppConfig::loadConfig();
