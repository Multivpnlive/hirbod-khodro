const RELEASE_AT = new Date(`${__HIRBOD_RELEASE_DATE__}T12:00:00.000Z`);

export const APP_VERSION = __HIRBOD_APP_VERSION__;
export const APP_RELEASE_DATE = __HIRBOD_RELEASE_DATE__;
export const APP_RELEASE_DATE_LABEL = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
  calendar: "persian",
  dateStyle: "long",
  timeZone: "UTC",
}).format(RELEASE_AT);
