<?php
namespace Fl;
use FL\Exceptions\ConfigException;

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

    /** Sentinel so we can tell "no default given" from "default is null". */
    private const NO_DEFAULT = "\0__fl_no_default__\0";

    /** All config values live here. config.php overrides/adds entries. */
    private static array $config = array();

    // loadConfig will overwrite certain values of the static variables with info found in a config.php files. This allows for more flexibility in putting this app live.
    // On the server the file config.php has to be read only to avoid being overwritten when all files are ftp'd to the live server

    public static function loadConfig($configPath)
    {
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

    /**
     * Get a config value. Supports dot notation for nested arrays:
     *   AppConfig::get("MailSettings.mailsorter.user")
     * Throws ConfigException if not found and no default was supplied.
     */
    public static function get($key, $default = self::NO_DEFAULT)
    {
        // exact match wins (keeps literal keys containing dots working)
        if (array_key_exists($key, self::$config)) {
            return self::$config[$key];
        }

        $value = self::$config;
        foreach (explode('.', (string) $key) as $segment) {
            if (is_array($value) && array_key_exists($segment, $value)) {
                $value = $value[$segment];
                continue;
            }
            if ($default !== self::NO_DEFAULT) {
                return $default;
            }
            throw new ConfigException("Config key $key not found");
        }
        return $value;
    }

    /** True if the (possibly dotted) key resolves to something. */
    public static function keyExists($key)
    {
        if (array_key_exists($key, self::$config)) {
            return true;
        }

        $value = self::$config;
        foreach (explode('.', (string) $key) as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return false;
            }
            $value = $value[$segment];
        }
        return true;
    }
}

