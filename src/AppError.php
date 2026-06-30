<?php

namespace FL;

class AppError
{
    /**
     * Stops all execution and renders an error screen.
     *
     * @param string $message  Message shown to the user.
     * @param int    $httpCode HTTP status to send (500, 503, 403...).
     * @param string|null $detail Optional technical detail (shown only when display_errors is on).
     */
    public static function halt(string $message, int $httpCode = 500, ?string $detail = null): void
    {
        // Throw away anything already buffered/rendered so the error page
        // isn't appended to a half-built response.
        while (ob_get_level() > 0) {
            ob_end_clean();
        }

        // Set the status line *before* any output. headers_sent() guards
        // against a warning if output already escaped (e.g. a stray echo).
        if (!headers_sent()) {
            http_response_code($httpCode);
            header('Content-Type: text/html; charset=utf-8');
        }

        $showDetail = ini_get('display_errors') && $detail !== null;

        // htmlspecialchars everything that reaches the page — never echo
        // a raw message, it may contain user-influenced data.
        $safeMessage = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
        $safeDetail  = $showDetail
            ? htmlspecialchars($detail, ENT_QUOTES, 'UTF-8')
            : '';

        echo <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Error $httpCode</title>
    <style>
        body { font-family: system-ui, sans-serif; background: #f4f4f5;
               color: #27272a; display: flex; min-height: 100vh;
               align-items: center; justify-content: center; margin: 0; }
        .box { background: #fff; border: 1px solid #e4e4e7; border-radius: 8px;
               padding: 2rem 2.5rem; max-width: 36rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
        h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
        .code { color: #a1a1aa; font-size: .85rem; }
        pre { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 6px;
              padding: .75rem; overflow: auto; font-size: .8rem; margin-top: 1rem; }
    </style>
</head>
<body>
    <div class="box">
        <div class="code">Error $httpCode</div>
        <h1>$safeMessage</h1>
HTML;

        if ($showDetail) {
            echo "<pre>$safeDetail</pre>";
        }

        echo <<<HTML
    </div>
</body>
</html>
HTML;
        Log::add($safeMessage . " [Detail:" . $safeDetail . "]", "APPLOG");
        exit;
    }
}