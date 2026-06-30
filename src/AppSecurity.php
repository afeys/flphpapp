<?php
namespace FL;
class AppSecurity
{
    const BOOTCHECK = "BOOTCHECK";

    public static function fileExistsAndReadOnly($filepath): bool
    {
        $returnvalue = false;
        if (file_exists($filepath)) {
            $perms = fileperms($filepath) & 0777;
            if ($perms === 0500) {
                $returnvalue = true;
            }
        }

        return $returnvalue;
    }
    public static function preBootCheck($configPath) {
        if (!Session::isSetSessionVariable(AppSecurity::BOOTCHECK)) {
            // check if the configPath file is readonly and not worldaccessible
            if (self::fileExistsAndReadOnly($configPath)) {
                Session::setSessionVariable(self::BOOTCHECK, "OK");
            } else {
                AppError::halt("The config file does not have the correct filepermissions (r-x------) !", 500);
            }
        }
    }
}

/*

 The correct approach is to mint your own per-tab identifier on the client and send it with every request. The standard trick uses sessionStorage, which is scoped per tab by design (unlike localStorage, which is shared across all tabs of an origin, and unlike cookies, also shared):
javascript// Runs once per tab. Duplicated tabs get a *fresh* sessionStorage copy
// at duplication time, but it then diverges — and crypto.randomUUID()
// guarantees uniqueness anyway.
let tabId = sessionStorage.getItem('tabId');
if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem('tabId', tabId);
}
Then attach tabId to your requests — as a custom header on fetch/XHR, a query param, or a hidden form field:
javascriptfetch('/some/action', {
    headers: { 'X-Tab-Id': tabId }
});
And on the PHP side, read it and namespace your per-tab state under the session:
php$tabId = $_SERVER['HTTP_X_TAB_ID'] ?? null;
// validate it looks like a UUID before trusting it as an array key
if ($tabId !== null && preg_match('/^[0-9a-f\-]{36}$/', $tabId)) {
    $_SESSION['tabs'][$tabId]['something'] = $value;
}
One wrinkle worth knowing for the duplicate-tab case specifically: when you duplicate a tab, the new tab inherits a snapshot of the original's sessionStorage, so both tabs briefly hold the same tabId. If precise behavior at the moment of duplication matters, the common fix is to detect duplication and regenerate — e.g. stamp a BroadcastChannel or a window-name token and, when a tab notices another live tab claiming its id, generate a new one. For most internal-tool use cases that level of rigor is overkill; the sessionStorage + UUID approach is enough, since any new navigation or reload in the duplicated tab will already have its own independent storage going forward.

 */