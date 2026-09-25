// The brocante this deployment serves, shown under the logo. The app is reset per event: update these two
// lines before each deployment. An empty string hides the line.
export const EVENT_NAME = 'Brocante de Saint-Arnoult'
export const EVENT_DATE = 'samedi 26 septembre'

export const EVENT_LABEL = [EVENT_NAME, EVENT_DATE].filter(Boolean).join(' · ')
