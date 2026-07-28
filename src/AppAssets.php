<?php

namespace FL;

class AppAssets
{
    private const DEFAULT_URL = '/assets/fl';
    private static bool $rendered = false;

    public static function baseUrl(): string
    {
        $url = defined('FLPHPAPP_ASSET_URL') ? FLPHPAPP_ASSET_URL : self::DEFAULT_URL;
        return rtrim($url, '/');
    }

    /** Head tags as a string. Emits nothing on its own. Safe to call twice. */
    public static function head(): string
    {
        if (self::$rendered) {
            return '';
        }
        self::$rendered = true;

        return self::tag('js',  'init.js',      'script')
            . self::tag('css', 'flphpapp.css', 'link')
            . self::bootstrap();
    }

    private static function tag(string $dir, string $file, string $kind): string
    {
        $docRoot = rtrim($_SERVER['DOCUMENT_ROOT'] ?? '', '/');
        if ($docRoot === '') {
            return '';
        }
        $base = self::baseUrl();
        $disk = $docRoot . '/' . trim($base, '/') . "/$dir/$file";
        if (!is_file($disk)) {
            return '';
        }
        $url = htmlspecialchars(
            "$base/$dir/$file?v=" . (filemtime($disk) ?: time()),
            ENT_QUOTES
        );
        return $kind === 'script'
            ? '<script type="module" src="' . $url . '"></script>' . "\n"
            : '<link rel="stylesheet" href="' . $url . '">' . "\n";
    }

    private static function bootstrap(): string
    {
        // Only meaningful once the session has actually started.
        $sid = session_status() === PHP_SESSION_ACTIVE ? session_id() : '';
        $sid = json_encode($sid, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES);

        return <<<HTML
<script>
  (function () {
    let tabId = sessionStorage.getItem('tabId');
    if (!tabId) {
      tabId = crypto.randomUUID();
      sessionStorage.setItem('tabId', tabId);
    }
    window.FL = window.FL || {};
    window.FL.tabId     = tabId;
    window.FL.sessionId = {$sid};
  })();
</script>

HTML;
    }
}