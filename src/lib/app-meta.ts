import appPackage from "../../package.json";

const RELEASE_AT = new Date(`${appPackage.releaseDate}T12:00:00.000Z`);

export const APP_VERSION = appPackage.version;
export const APP_RELEASE_DATE = appPackage.releaseDate;
export const APP_RELEASE_DATE_LABEL = new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", {
  calendar: "persian",
  dateStyle: "long",
  timeZone: "UTC",
}).format(RELEASE_AT);
