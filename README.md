# Boundary Explorer

A static website for exploring and comparing electoral boundaries across redistribution projects. One shared map engine supports federal and state projects, party submissions, official proposals and final boundaries.

**Currently available:**

- Queensland federal redistribution, 2026 (default): Current, ALP, LNP and Greens boundaries.
- South Australia federal boundaries, 2018–2026: old and new boundaries, with 10 electorates in each file.

Select a project from the project dropdown. Additional projects appear when their configuration and boundary files are registered.

## Run locally

```sh
python3 -m http.server 8080
```

Open <http://localhost:8080>. No build or package installation is required. Use HTTP rather than opening `index.html` directly: the app fetches GeoJSON and uses JavaScript modules. MapLibre, Turf, basemap tiles and fonts need an internet connection.

### Tests

With Node.js 20 or later:

```sh
npm test
```

These dependency-free tests cover project configuration, dataset eligibility, shared-view defaults, GeoJSON field/name mapping, project URLs, release-version propagation and background-worker readiness/cancellation/retry behaviour.

## Projects and links

The project selector navigates to a unique URL:

```text
?project=qld-federal-2026
?project=sa-federal-2026
```

The hash stores the comparison and map view. For example:

```text
?project=qld-federal-2026#a=current&b=lnp&mode=change&electorate=Griffith
```

- Opening the site without a project loads `DEFAULT_PROJECT_ID` from `projects.js`.
- Existing Queensland hash-only links still work; the default project is added to their URL.
- An unknown project falls back to the default and displays a notice.
- Switching projects starts at that project's defaults, clearing the previous project's electorate and camera. Browser Back/Forward returns to previous project views.
- **Copy link** includes the project, datasets, mode, camera, divider, labels, reference setting and the selected electorate in Change mode.

## Explore

- **Boundary buttons:** select the versions for A and B. Labels, colours, side restrictions and availability are defined by each project. Queensland's Current version is available only in A; ALP, LNP and Greens suggestions are available on either side. Swap is enabled only when both versions are allowed on the opposite side.
- **Swipe:** drag the divider, or focus it and use Left/Right (Home/End reveal one full map).
- **Overlay:** A is an outline only; B is a translucent fill with subtle edges, drawn above A. B's unhighlighted fill is lighter and the hovered/searched electorate is darker. Only B receives highlights, using its dataset colour.
- **Change:** A is the starting version; B is the destination. All A outlines stay visible. Click an A electorate, use the dropdown, or step alphabetically with previous/next. Green shows territory added in B (`B − A`), red with dashed edges shows territory removed from A (`A − B`), and faint grey shows retained territory (`A ∩ B`). A's outlines are dashed; the selected B outline is solid. The legend reports approximate geographic areas in km². **Fit electorate** restores the extent after panning.
- Outside Change mode, hover or tap a location to inspect the electorate under both datasets. Search fits an electorate's combined extent across the selected versions.
- Project-specific quick views and a home button navigate to the region. Electorate names and an optional baseline outline can be toggled.

Colours identify boundary sources, not seat ownership or electoral outcomes. In Change mode, green/red instead identify geographic additions/removals, not parties or voter counts.

## Add a project

1. Create `projects/<project-id>/config.js` and a `data/` folder alongside it.
2. Add that project's WGS84 GeoJSON files.
3. Export a configuration using the example below. `projects/qld-federal-2026/config.js` is the working reference.
4. Add `loadProject('./projects/<project-id>/config.js')` to the `PROJECTS` list in `projects.js`. It appears in the dropdown automatically. The loader propagates the release version so newly published configuration is not mixed with cached files.

Example configuration (replace filenames and metadata with your real project):

```js
const dataPath = (name) => new URL(`./data/${name}.geojson`, import.meta.url).href;

export default {
  id: 'tas-federal',
  label: 'Tasmania · Federal',
  subtitle: 'Federal boundary comparison',
  stage: 'Suggestions stage',
  description: 'Compare suggested federal electoral boundaries in Tasmania.',
  electorateLabel: 'federal electorates',
  nameProperty: 'name',
  baselineDataset: 'current', // Optional; omit if no reference layer is wanted.
  defaults: { left: 'current', right: 'lib', electorate: 'Clark', mode: 'overlay' },
  map: {
    center: [146.6, -42],
    zoom: 6.5,
    overview: { label: 'All Tasmania', bounds: [[143.5, -43.9], [149, -39]] },
    views: [{ label: 'Hobart', bounds: [[147, -43], [147.6, -42.5]] }],
  },
  about: ['Describe the sources, dates and status of these boundaries here.'],
  datasets: [
    { id: 'current', label: 'Current boundaries', short: 'Current', description: 'Existing divisions', color: '#666b70', path: dataPath('current'), sides: ['left'] },
    { id: 'lib', label: 'Liberal suggestion', short: 'LIB', description: 'Liberal Party submission', color: '#2161a6', path: dataPath('lib') },
    { id: 'alp', label: 'ALP suggestion', short: 'ALP', description: 'Map coming soon', color: '#ba3b47', path: null },
  ],
};
```

Project IDs and dataset IDs should be stable: they are used by shared links. Include a redistribution year in the project ID when comparing different cycles for the same jurisdiction. No party IDs or electorate counts are hardcoded into the shared app.

### Dataset configuration

- `id`, `label`, `color`, `path`: identifier, full name, hex colour and GeoJSON URL.
- `short`: compact label; optional `buttonLabel` overrides it on the boundary buttons.
- `description`: submission/version details, or a forthcoming-map message.
- `path: null`: disabled button. `hideWhenUnavailable: true` hides it until a path is supplied.
- `sides: ['left']` or `['right']`: restrict a dataset to one side. Omit for both.
- `nameProperty`: optional per-dataset override of the project's GeoJSON name field.
- `nameAliases`: optional mapping from a formatted source name to a canonical comparison name, for example `{ 'Old Division': 'New Division' }`. Project-level mappings are also supported; dataset mappings take precedence. Use only when an explicit same-electorate mapping is intended. Original map labels and hover names are preserved; Change mode shows both names and search accepts either.

All dataset files must be WGS84 longitude/latitude GeoJSON FeatureCollections containing Polygon or MultiPolygon features. Every feature must contain a non-empty name in the configured property. Original files are not modified. Underscores and capitalisation are normalised for display and matching; mixed-case names are preserved where possible.

Paths built with `new URL(..., import.meta.url)` work both locally and under a GitHub Pages repository path. Queensland's existing files remain in the root `data/` folder; its config resolves those paths relative to itself.

### Link an electorate name change

Add `nameAliases` to the dataset with the former name, mapping it to the name used by the newer dataset. For example, South Australia's 2018 dataset contains:

```js
nameAliases: { Grey: "O'Donoghue" }
```

Grey and O'Donoghue then form one comparison entry, **Grey → O'Donoghue**, rather than separate removed/added electorates. Swapping A and B reverses the label. Maps retain the names used in each source file, and searching either name fits both versions. Shared links using the former name are resolved when that version is selected. For multiple historical names, map each former name directly to the same canonical name; mappings are explicit, not inferred or chained.

### Add the Queensland official proposal

Put the file at `data/qld_2028_proposed.geojson`, then edit its entry in `projects/qld-federal-2026/config.js`: replace `path: null` with `path: dataPath('proposed')` and update its description.

## Geometry and provenance

Change mode uses Turf.js polygon differences and intersection without snapping or simplifying the supplied coordinates. Electorates match by formatted/canonical name; renamings are not inferred. An electorate present on one side only is shown as wholly added or removed, with a note. Disconnected polygons and holes are preserved.

Tiny differences may reflect digitisation rather than intended changes. Areas are approximate geographic measurements, not enrolment or voter counts.

### Mobile performance

- Overlay and Change use one map renderer. Swipe creates a second renderer only while that mode is active.
- Shared-link updates are debounced until gestures settle; synchronised animation frames do not write browser history.
- Change calculations run in a cancellable background worker. Only the selected electorate's geometry is sent to it, and Turf is loaded there on demand rather than on the UI thread. The first request waits for a readiness handshake so slow worker startup cannot lose it. A newer selection cancels obsolete calculations.
- Full-precision comparison results are cached with a 20-entry limit. Display toggles do not resend unchanged GeoJSON to the map workers.
- Rendering resolution is capped at 2× CSS pixels to reduce GPU load on high-density phones. Touch interaction inspects on tap rather than running hover queries while panning.
- A resize observer keeps the map canvas aligned with the available space when controls or browser dimensions change.

The Queensland project uses user-supplied `qld_2028_current.geojson`, `qld_2028_alp.geojson`, `qld_2028_lnp.geojson` and `qld_2028_grn.geojson`, each containing 30 features. Source document URLs, licensing and digitisation details have not yet been supplied. Party suggestions are distinct from the forthcoming official proposal.

The South Australian project uses user-supplied `sa_2018.geojson` and `sa_2026.geojson`, each containing 10 features. It defaults to 2018 in A and 2026 in B, with both versions available on either side. Grey (2018) is explicitly linked to O’Donoghue (2026) using a dataset name mapping. Source document URLs, licensing and digitisation details have not yet been supplied.

## Publish on GitHub Pages

This is a plain static site, suitable for a repository named **boundary-explorer**. Enable GitHub Pages for the branch/folder containing `index.html`. No bundling step or server-side routing is needed; project selection uses query parameters, so links work under the repository's Pages URL.

### Release versions and caching

When publishing changes to code, configuration or data, bump the matching `v=` values on the app and stylesheet URLs in `index.html` (for example, `2026-10-22.1` → `2026-10-22.2`). The app carries that version through project configuration, worker code, the comparison module and same-origin GeoJSON requests. Pinned third-party libraries retain their existing URLs.

This matters on hosts/CDNs that cache JavaScript for hours. Without versioned asset URLs, a fresh HTML page can load older cached JavaScript expecting a different setup—such as expecting the geometry library on the UI thread when the new page loads it in a worker. Shared project/comparison links remain unchanged.

## Structure

```text
index.html                  Shared interface
style.css                   Responsive styles
app.js                      Map interactions and project selection
changes.js                  Polygon comparisons
change-calculator.js        Cancellable background-calculation client
change-worker.js            On-demand Turf worker (off the UI thread)
project-config.js           Configuration, view defaults and data normalisation
projects.js                 Project registry and default project
projects/<id>/config.js     Project-specific metadata, versions and map views
data/                       Queensland and South Australian GeoJSON files
tests/                      Dependency-free configuration tests
```

MapLibre GL JS 4.7.1 and Turf.js 7.2.0 are loaded from unpkg. The basemap is OpenFreeMap Positron, with attribution on the map. The original swipe concept was inspired by `jaxlab/tools/qld-map`.
