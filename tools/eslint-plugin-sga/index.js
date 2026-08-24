import noVendorNames from "./rules/no-vendor-names.js";
import noModuleLevelMutableState from "./rules/no-module-level-mutable-state.js";
import noForbiddenBrowserApis from "./rules/no-forbidden-browser-apis.js";

export default {
  rules: {
    "no-vendor-names": noVendorNames,
    "no-module-level-mutable-state": noModuleLevelMutableState,
    "no-forbidden-browser-apis": noForbiddenBrowserApis,
  },
};
