<?php
// Public URL where this package's JS is served.
// The main project can define this BEFORE including init.php to override it.
if (!defined('FLPHPAPP_ASSET_URL')) {
    define('FLPHPAPP_ASSET_URL', '/assets/fl');
}
$flEntryJS = 'init.js';
$flEntryCSS = 'flphpapp.css';
$flBase = htmlspecialchars(rtrim(FLPHPAPP_ASSET_URL, '/'), ENT_QUOTES);

// URL path -> filesystem path under the docroot.
$docRoot  = rtrim($_SERVER['DOCUMENT_ROOT'] ?? '', '/');
$diskPath = $docRoot . '/' . trim($flBase, '/') . '/js/' . $flEntryJS;

if ($docRoot !== '' && is_file($diskPath)) {
    $ver = filemtime($diskPath) ?: time();   // cache-bust when the file changes
    $src = htmlspecialchars($flBase . '/' . $flEntryJS . '?v=' . $ver, ENT_QUOTES);
    echo '<script type="module" src="' . $src . '"></script>';
}
$diskPath = $docRoot . '/' . trim($flBase, '/') . '/css/' . $flEntryCSS;

if ($docRoot !== '' && is_file($diskPath)) {
    $ver = filemtime($diskPath) ?: time();   // cache-bust when the file changes
    $src = htmlspecialchars($flBase . '/' . $flEntryCSS . '?v=' . $ver, ENT_QUOTES);
    echo '<link rel="stylesheet" href="' . $src . '">';
}
?>
<script>
    let tabId = sessionStorage.getItem('tabId');
    if (!tabId) {
        tabId = crypto.randomUUID();
        sessionStorage.setItem('tabId', tabId);
    }
    console.log("flphpapp - init.php - blablabla " + tabId);

    function callURL($url) {
        console.log("callurl " + $url + "headers: X-Tab-Id: " + tabId + " X-Session-Id: " + '<?php echo session_id(); ?>' + "");
   //     javascriptfetch('/some/action', {
   //         headers: {  'X-Tab-Id': tabId,
   //                     'X-Session-Id': '<?php echo session_id(); ?>' }
   //     });
    }
</script>
