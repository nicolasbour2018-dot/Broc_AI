// Admin keeps the pre-redesign stylesheet. Loaded lazily, so the public app never ships legacy.css
// and the admin console renders exactly as before. Order matters: the old app loaded admin.css
// (through App) before styles.css, so legacy.css must come after the component's own stylesheet.
export { default } from '../Admin'
import '../legacy.css'
