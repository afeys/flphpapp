<?php
require_once(dirname(__FILE__) . '/AppConfig.php');
require_once(dirname(__FILE__) . '/AppError.php');
require_once(dirname(__FILE__) . '/AppSecurity.php');
require_once(dirname(__FILE__) . '/AppRunner.php');
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
