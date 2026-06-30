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
    /** All config values live here. config.php overrides/adds entries. */
    private static array $config = array();

    // loadConfig will overwrite certain values of the static variables with info found in a config.php files. This allows for more flexibility in putting this app live.
    // On the server the file config.php has to be read only to avoid being overwritten when all files are ftp'd to the live server

    public static function loadConfig($configPath)
    {
        echo "AppConfig::loadConfig called with $configPath<br>";
        if (file_exists($configPath)) {
            $config = include $configPath; // Load PHP array config
            foreach ($config as $key => $value) {
                self::$config[$key] = $value;
            }

            // loading the database connections in the ConnectionManager
            if (self::keyExists("DBConnections")) {
                $connmgr = \FL\ConnectionManager::getInstance();
                foreach (self::get("DBConnections") as $name => $conn) {
                    $host   = $conn["host"]   ?? "";
                    $user   = $conn["user"]   ?? "";
                    $pwd    = $conn["pwd"]    ?? "";
                    $dbname = $conn["dbname"] ?? "";
                    $connmgr->addConnection(
                        \FL\Connection::getInstance($name, $host, $user, $pwd, $dbname)
                    );
                }
            }

            // loading the model directories
            if (self::keyExists("DBModelDirs")) {
                foreach (self::get("DBModelDirs") as $dir) {
                    \FL\Model::initialize(array(self::get("BaseDirectory") . $dir));
                }
            }
        }
    }

    public static function getConfig() {
        return self::$config;
    }

    public static function get($key) {
        if (self::keyExists( $key)) {
            return self::$config[$key];
        } else {
            throw new ConfigException("Config key $key not found");
        }
    }

    public static function keyExists($key) {
        return array_key_exists($key, self::$config);
    }
}

