<?php
// Public URL where this package's JS is served.
// The main project can define this BEFORE including init.php to override it.
if (!defined('FLPHPAPP_ASSET_URL')) {
    define('FLPHPAPP_ASSET_URL', '/assets/fl');
}
$flEntry = 'init.js';
$flBase = htmlspecialchars(rtrim(FLPHPAPP_ASSET_URL, '/'), ENT_QUOTES);

// URL path -> filesystem path under the docroot.
$docRoot  = rtrim($_SERVER['DOCUMENT_ROOT'] ?? '', '/');
$diskPath = $docRoot . '/' . trim($flBase, '/') . '/' . $flEntry;

if ($docRoot !== '' && is_file($diskPath)) {
    $ver = filemtime($diskPath) ?: time();   // cache-bust when the file changes
    $src = htmlspecialchars($flBase . '/' . $flEntry . '?v=' . $ver, ENT_QUOTES);
    echo '<script type="module" src="' . $src . '"></script>';
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
