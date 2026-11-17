'use strict';

/* ---------- Language ---------- */

// Set to null to follow the browser language (French translations below are kept for that).
const FORCED_LANG = 'en';
const DETECTED_LANG = (navigator.languages?.[0] || navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
const LANG = FORCED_LANG ?? DETECTED_LANG;
const LOCALE = LANG === 'fr' ? 'fr-FR' : 'en-US';
const t = (english, french) => (LANG === 'fr' ? french : english);

const STATIC_TRANSLATIONS_FR = {
    'intro-greeting': 'Bonjour <span id="intro-fingerprint" class="intro-fingerprint"></span>',
    'hero-title': 'Navigation privée ? Laisse moi rire.',
    'hero-intro': `Tu n'as rien cliqué, rien accepté, rien tapé. Pourtant, voici tout ce qu'un site peut apprendre
        sur toi en quelques millisecondes. Combinés, ces détails forment une <strong>empreinte</strong> qui te reconnaît
        d'un site à l'autre, même sans cookies, et que les CAPTCHA « invisibles » utilisent pour décider si
        tu es humain.`,
    'privacy-note': `Cette page est un simple fichier, sans serveur : tout est calculé dans ton navigateur, puis oublié quand tu la fermes.
        Seule ton IP est vue par un service de géolocalisation (<code>freeipapi.com</code>, sinon <code>ipapi.co</code>
        ou <code>ipwho.is</code>).`,
    'hero-aside-server': `Un vrai site voit aussi, côté serveur et <strong>même si tu bloques JavaScript</strong> : ton IP, les en-têtes HTTP
        de chaque requête et l'empreinte de ta connexion chiffrée (TLS), très utilisée par les systèmes anti-bots.`,
    'kofi-link': 'Merci de m\'avoir sensibilisé',
    'share-button': 'Sensibiliser à mon tour',
    'game-button': 'Détruire plus de navigations privées',
    'game-score-label': 'Score',
    'game-over-title': 'Game over',
    'game-over-greeting': 'Bien joué <span id="game-over-fingerprint" class="intro-fingerprint"></span>',
    'game-over-reminder': 'Oui, on sait toujours qui tu es.',
    'game-over-score': 'Navigations privées détruites',
    'game-home-button': 'Retour à l\'accueil',
    'game-share-button': 'Partager mon score',
    'hero-aside-advice': `Pour réduire ton empreinte : un navigateur qui uniformise ou brouille ces valeurs (Tor Browser, Mullvad Browser,
        Brave, Firefox avec <code>privacy.resistFingerprinting</code>), un VPN pour l'IP, et refuser les permissions inutiles.
        Paradoxe : trop d'extensions anti-pistage rendent souvent ton empreinte <em>plus</em> unique.`,
};

const STATIC_ATTRIBUTE_TRANSLATIONS_FR = [
    ['intro-loader', 'aria-label', 'Chargement'],
    ['intro-reveal', 'title', 'Qu\'est-ce que c\'est ?'],
    ['intro-reveal', 'aria-label', 'Qu\'est-ce que c\'est ?'],
    ['section-menu', 'aria-label', 'Sections'],
    ['back-to-top', 'title', 'Retour en haut'],
    ['back-to-top', 'aria-label', 'Retour en haut'],
];

function translateStaticPage() {
    document.documentElement.lang = LANG;
    if (LANG !== 'fr') {
        return;
    }
    document.title = 'Rien à cacher ?';
    document.querySelector('meta[name="description"]')?.setAttribute('content', 'Ouvre cette page. Ne clique sur rien.');
    document.querySelectorAll('[data-i18n]').forEach((element) => {
        const translation = STATIC_TRANSLATIONS_FR[element.dataset.i18n];
        if (translation) {
            element.innerHTML = translation;
        }
    });
    STATIC_ATTRIBUTE_TRANSLATIONS_FR.forEach(([elementId, attribute, value]) => {
        document.getElementById(elementId)?.setAttribute(attribute, value);
    });
}

translateStaticPage();

const UNSUPPORTED = Symbol('unsupported');
const SECTION_TIMEOUT_MS = 6000;
const IP_LOOKUP_TIMEOUT_MS = 2500;
const isServerObservationAvailable = Boolean(window.SERVER_OBSERVATION);
const serverObservation = window.SERVER_OBSERVATION || {};
const portraitFacts = {};

const row = (label, value, note) => ({ label, value, note });
const volatileRow = (label, value, note) => ({ label, value, note, volatile: true });
const orUnsupported = (value) => (value === undefined || value === null || value === '' ? UNSUPPORTED : value);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, message) {
    return Promise.race([promise, wait(ms).then(() => { throw new Error(message); })]);
}

function hashText(text) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

function matchesMedia(query) {
    return window.matchMedia(query).matches;
}

function firstMatchingMedia(feature, candidates) {
    return candidates.find((candidate) => matchesMedia(`(${feature}: ${candidate})`)) ?? UNSUPPORTED;
}

/* ---------- Collectors ---------- */

async function collectNetwork() {
    const rows = isServerObservationAvailable ? [
        row(t('IP address seen by the server', 'Adresse IP vue par le serveur'), orUnsupported(serverObservation.ip)),
        row(t('Source port', 'Port source'), orUnsupported(serverObservation.remotePort)),
        row('X-Forwarded-For', orUnsupported(serverObservation.forwardedFor), t('Sometimes reveals the real IP behind a misconfigured proxy', 'Révèle parfois la vraie IP derrière un proxy mal configuré')),
        row(t('Reverse DNS', 'DNS inverse'), orUnsupported(serverObservation.reverseDns), t('The hostname often gives away the ISP and the city', 'Le nom d\'hôte trahit souvent le FAI et la ville')),
        row(t('Protocol', 'Protocole'), orUnsupported(serverObservation.protocol)),
        row('HTTPS', Boolean(serverObservation.https)),
    ] : [];

    const ipGeolocation = await resolveIpGeolocation();
    if (ipGeolocation.status !== 'success') {
        throw new Error(`${t('IP geolocation failed', 'Échec de la géolocalisation IP')} : ${ipGeolocation.message || t('unknown error', 'erreur inconnue')}`);
    }

    if (!serverObservation.geolocation) {
        const browserLookupNote = isServerObservationAvailable
            ? t('The server sees you on a private IP (local network): the public IP was obtained by your browser', 'Le serveur te voit sur une IP privée (réseau local) : l\'IP publique a été obtenue par ton navigateur')
            : t(`Obtained with a single request to ${ipGeolocation.source}: any website can do the same`, `Obtenue avec une seule requête à ${ipGeolocation.source} : n'importe quel site peut faire pareil`);
        rows.unshift(row(t('Public IP', 'IP publique'), ipGeolocation.query, browserLookupNote));
    }

    portraitFacts.internetProvider = ipGeolocation.isp;
    portraitFacts.place = [ipGeolocation.city, ipGeolocation.country].filter(Boolean).join(', ');

    return rows.concat([
        row(t('Country', 'Pays'), `${ipGeolocation.country} (${ipGeolocation.countryCode})`),
        row(t('Region / city', 'Région / ville'), [ipGeolocation.regionName, ipGeolocation.city, ipGeolocation.zip].filter(Boolean).join(' — ')),
        row(t('Approximate coordinates', 'Coordonnées approximatives'), `${ipGeolocation.lat}, ${ipGeolocation.lon}`, t('Typical accuracy: neighbourhood to city', 'Précision typique : du quartier à la ville')),
        row(t('IP time zone', 'Fuseau horaire de l\'IP'), orUnsupported(ipGeolocation.timezone)),
        row(t('ISP', 'FAI'), orUnsupported(ipGeolocation.isp)),
        row(t('Organization', 'Organisation'), orUnsupported(ipGeolocation.org)),
        row(t('AS (autonomous system)', 'AS (système autonome)'), orUnsupported(ipGeolocation.as)),
        row(t('Mobile connection (4G/5G)', 'Connexion mobile (4G/5G)'), orUnsupported(ipGeolocation.mobile)),
        row(t('Proxy / VPN / Tor detected', 'Proxy / VPN / Tor détecté'), orUnsupported(ipGeolocation.proxy), t('CAPTCHAs get stricter if so', 'Si oui, les CAPTCHA se durcissent')),
        row(t('Hosting IP (datacenter)', 'IP d\'hébergeur (datacenter)'), orUnsupported(ipGeolocation.hosting), t('A \"human\" on a datacenter IP looks suspicious to anti-bot systems', 'Un « humain » sur une IP de datacenter paraît suspect aux systèmes anti-bots')),
        row(t('Geolocation source', 'Source de la géolocalisation'), ipGeolocation.source),
    ]);
}

let ipGeolocationPromise = null;

function resolveIpGeolocation() {
    if (!ipGeolocationPromise) {
        ipGeolocationPromise = serverObservation.geolocation
            ? Promise.resolve({ ...serverObservation.geolocation, source: t('ip-api.com (server side)', 'ip-api.com (côté serveur)') })
            : lookupIpGeolocationFromBrowser();
    }
    return ipGeolocationPromise;
}

const browserIpGeolocationProviders = [
    {
        name: 'freeipapi.com',
        url: 'https://free.freeipapi.com/api/v1/json',
        toIpGeolocation: (data) => ({
            query: data.ipAddress,
            country: data.countryName,
            countryCode: data.countryCode,
            regionName: data.regionName,
            city: data.cityName,
            zip: data.zipCode,
            lat: data.latitude,
            lon: data.longitude,
            timezone: data.timeZones?.[0],
            isp: data.asnOrganization,
            org: data.asnOrganization,
            as: data.asn ? `AS${data.asn} ${data.asnOrganization}` : undefined,
            proxy: data.isProxy,
        }),
    },
    {
        name: 'ipapi.co',
        url: 'https://ipapi.co/json/',
        toIpGeolocation: (data) => ({
            query: data.ip,
            country: data.country_name,
            countryCode: data.country_code,
            regionName: data.region,
            city: data.city,
            zip: data.postal,
            lat: data.latitude,
            lon: data.longitude,
            timezone: data.timezone,
            isp: data.org,
            org: data.org,
            as: data.asn,
        }),
    },
    {
        name: 'ipwho.is',
        url: 'https://ipwho.is/',
        toIpGeolocation: (data) => ({
            query: data.ip,
            country: data.country,
            countryCode: data.country_code,
            regionName: data.region,
            city: data.city,
            zip: data.postal,
            lat: data.latitude,
            lon: data.longitude,
            timezone: data.timezone?.id,
            isp: data.connection?.isp,
            org: data.connection?.org,
            as: data.connection?.asn ? `AS${data.connection.asn}` : undefined,
        }),
    },
];

async function lookupIpGeolocationFromBrowser() {
    const failures = [];
    for (const provider of browserIpGeolocationProviders) {
        try {
            const response = await fetch(provider.url, { signal: AbortSignal.timeout(IP_LOOKUP_TIMEOUT_MS) });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            if (data.error || data.success === false) {
                throw new Error(data.reason || data.message || 'error response');
            }
            return { status: 'success', source: provider.name, ...provider.toIpGeolocation(data) };
        } catch (error) {
            console.error(`IP geolocation via ${provider.name} failed`, error);
            failures.push(`${provider.name}: ${error.message}`);
        }
    }
    return { status: 'fail', message: failures.join('; ') };
}

function collectHttpHeaders() {
    const headers = serverObservation.headers || {};
    return Object.entries(headers).map(([name, value]) => row(name, value));
}

async function collectBrowserAndOs() {
    const nav = navigator;
    const rows = [
        row('User-Agent', nav.userAgent),
        row(t('Platform (navigator.platform)', 'Plateforme (navigator.platform)'), orUnsupported(nav.platform)),
        row(t('Vendor', 'Fabricant'), orUnsupported(nav.vendor)),
        row(t('Main language', 'Langue principale'), orUnsupported(nav.language)),
        row(t('Accepted languages', 'Langues acceptées'), nav.languages ? nav.languages.join(', ') : UNSUPPORTED),
        row(t('Cookies enabled', 'Cookies activés'), nav.cookieEnabled),
        row('Do Not Track', orUnsupported(nav.doNotTrack), t('Irony: turning DNT on adds a bit of entropy to your fingerprint', 'Ironie : activer DNT ajoute un peu d\'entropie à ton empreinte')),
        row('Global Privacy Control', nav.globalPrivacyControl ?? UNSUPPORTED),
        row(t('Built-in PDF viewer', 'Lecteur PDF intégré'), nav.pdfViewerEnabled ?? UNSUPPORTED),
        row('Plugins', nav.plugins ? Array.from(nav.plugins, (plugin) => plugin.name) : UNSUPPORTED),
        row(t('MIME types', 'Types MIME'), nav.mimeTypes ? nav.mimeTypes.length : UNSUPPORTED),
        row(t('Driven by a bot (navigator.webdriver)', 'Piloté par un robot (navigator.webdriver)'), nav.webdriver ?? UNSUPPORTED),
        volatileRow(t('Tab history (pages)', 'Historique de l\'onglet (pages)'), history.length),
        volatileRow(t('Previous page (referrer)', 'Page précédente (referrer)'), orUnsupported(document.referrer)),
    ];

    let systemLabel = describeOsFromUserAgent(nav.userAgent);
    if (nav.userAgentData) {
        const highEntropy = await nav.userAgentData.getHighEntropyValues([
            'architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList', 'wow64', 'formFactors',
        ]);
        const platformLabel = describePlatform(highEntropy.platform || nav.userAgentData.platform, highEntropy.platformVersion);
        systemLabel = platformLabel;
        rows.push(
            row(t('Client Hints: system', 'Client Hints : système'), platformLabel, t('Exact OS version, even though the User-Agent now hides it', 'Version exacte de l\'OS, alors que le User-Agent la cache désormais')),
            row(t('Client Hints: architecture', 'Client Hints : architecture'), `${orUnsupported(highEntropy.architecture).toString()} ${highEntropy.bitness || ''} bits`),
            row(t('Client Hints: device model', 'Client Hints : modèle d\'appareil'), orUnsupported(highEntropy.model)),
            row(t('Client Hints: mobile', 'Client Hints : mobile'), nav.userAgentData.mobile),
            row(t('Client Hints: form factor', 'Client Hints : format'), orUnsupported(highEntropy.formFactors?.join(', '))),
            row(t('Client Hints: browsers', 'Client Hints : navigateurs'), highEntropy.fullVersionList?.map((brand) => `${brand.brand} ${brand.version}`) ?? UNSUPPORTED),
        );
    } else {
        rows.push(row('Client Hints (userAgentData)', UNSUPPORTED, t('Firefox and Safari do not expose them', 'Firefox et Safari ne les exposent pas')));
    }

    const browserLabel = describeBrowser(nav.userAgent);
    rows.unshift(row(t('Operating system', 'Système d\'exploitation'), systemLabel), row(t('Browser', 'Navigateur'), browserLabel));
    portraitFacts.device = describeDevice(systemLabel);
    portraitFacts.browser = browserLabel === t('Unknown', 'Inconnu') ? undefined : browserLabel.split('.')[0];
    portraitFacts.language = describeLanguage(nav.language);
    return rows;
}

function describeDevice(systemLabel) {
    const devicePatterns = [
        [/^Windows 11/, t('a Windows 11 PC', 'un PC Windows 11')], [/^Windows/, t('a Windows PC', 'un PC Windows')], [/^(macOS|Mac OS)/, t('a Mac', 'un Mac')],
        [/^iPadOS/, t('an iPad', 'un iPad')], [/^iOS|^iPhone/, t('an iPhone', 'un iPhone')], [/^Android/, t('an Android device', 'un appareil Android')],
        [/^(Chrome ?OS)/, t('a Chromebook', 'un Chromebook')], [/^Linux/, t('a Linux PC', 'un PC Linux')],
    ];
    return devicePatterns.find(([pattern]) => pattern.test(systemLabel))?.[1];
}

function describeLanguage(languageTag) {
    if (!languageTag) {
        return undefined;
    }
    try {
        return new Intl.DisplayNames([LANG], { type: 'language' }).of(languageTag);
    } catch (error) {
        console.error('Cannot describe language', error);
        return languageTag;
    }
}

function describePlatform(platform, platformVersion) {
    if (platform === 'Windows' && platformVersion) {
        return Number(platformVersion.split('.')[0]) >= 13 ? 'Windows 11' : t('Windows 10 or earlier', 'Windows 10 ou antérieur');
    }
    return [platform, platformVersion].filter(Boolean).join(' ');
}

function describeBrowser(userAgent) {
    const browserPatterns = [
        ['Edge', /Edg\/([\d.]+)/], ['Opera', /OPR\/([\d.]+)/], ['Firefox', /Firefox\/([\d.]+)/],
        ['Chrome', /Chrome\/([\d.]+)/], ['Safari', /Version\/([\d.]+).*Safari/],
    ];
    const match = browserPatterns.map(([name, pattern]) => [name, userAgent.match(pattern)]).find(([, found]) => found);
    return match ? `${match[0]} ${match[1][1]}` : t('Unknown', 'Inconnu');
}

function describeOsFromUserAgent(userAgent) {
    const osPatterns = [
        ['Android', /Android [\d.]+/], ['iOS', /iPhone OS [\d_]+/], ['iPadOS', /CPU OS [\d_]+/],
        ['macOS', /Mac OS X [\d_.]+/], ['Windows', /Windows NT [\d.]+/], ['Linux', /Linux/], ['ChromeOS', /CrOS/],
    ];
    const match = osPatterns.find(([, pattern]) => pattern.test(userAgent));
    return match ? userAgent.match(match[1])[0].replace(/_/g, '.') : t('Unknown', 'Inconnu');
}

function collectHardware() {
    const memory = performance.memory;
    return [
        row(t('Logical CPU cores', 'Cœurs de processeur logiques'), orUnsupported(navigator.hardwareConcurrency)),
        row(t('RAM (rounded, GB)', 'RAM (arrondie, Go)'), orUnsupported(navigator.deviceMemory), t('Deliberately capped at 8 GB by Chrome to limit tracking', 'Volontairement plafonnée à 8 Go par Chrome pour limiter le pistage')),
        row(t('Touch points', 'Points de contact tactiles'), navigator.maxTouchPoints ?? UNSUPPORTED),
        row(t('Touch screen', 'Écran tactile'), 'ontouchstart' in window),
        row(t('JavaScript heap limit', 'Limite du tas JavaScript'), memory ? `${Math.round(memory.jsHeapSizeLimit / 1048576)} ${t('MB', 'Mo')}` : UNSUPPORTED),
        row(t('Primary pointer', 'Pointeur principal'), firstMatchingMedia('pointer', ['fine', 'coarse', 'none'])),
        row(t('Hover capable (mouse)', 'Survol possible (souris)'), firstMatchingMedia('hover', ['hover', 'none'])),
        volatileRow(t('Timer resolution', 'Résolution du chronomètre'), `${measureTimerResolution()} ms`),
    ];
}

function measureTimerResolution() {
    let smallestStep = Infinity;
    let previous = performance.now();
    for (let i = 0; i < 2000; i++) {
        const current = performance.now();
        if (current > previous) {
            smallestStep = Math.min(smallestStep, current - previous);
        }
        previous = current;
    }
    return smallestStep === Infinity ? '?' : smallestStep.toFixed(4);
}

async function measureRefreshRate() {
    const SAMPLE_FRAMES = 60;
    const MIN_FRAMES = 10;
    const TIMEOUT_MS = 2000;
    const SNAP_TOLERANCE_RATIO = 0.05;
    const COMMON_REFRESH_RATES_HZ = [60, 75, 90, 100, 120, 144, 165, 180, 240, 360];
    const frameIntervals = await new Promise((resolve) => {
        const intervals = [];
        let previousFrameAt = null;
        let isDone = false;
        const finish = () => {
            isDone = true;
            resolve(intervals);
        };
        const timeout = setTimeout(finish, TIMEOUT_MS);
        const recordFrame = (frameAt) => {
            if (isDone) {
                return;
            }
            if (previousFrameAt !== null) {
                intervals.push(frameAt - previousFrameAt);
            }
            previousFrameAt = frameAt;
            if (intervals.length >= SAMPLE_FRAMES) {
                clearTimeout(timeout);
                finish();
                return;
            }
            requestAnimationFrame(recordFrame);
        };
        requestAnimationFrame(recordFrame);
    });
    if (frameIntervals.length < MIN_FRAMES) {
        return null;
    }
    const sortedIntervals = [...frameIntervals].sort((a, b) => a - b);
    const measuredHz = 1000 / sortedIntervals[Math.floor(sortedIntervals.length / 2)];
    const closestCommonHz = COMMON_REFRESH_RATES_HZ.reduce((best, rate) => (Math.abs(rate - measuredHz) < Math.abs(best - measuredHz) ? rate : best));
    return Math.abs(closestCommonHz - measuredHz) / closestCommonHz < SNAP_TOLERANCE_RATIO ? closestCommonHz : Math.round(measuredHz);
}

async function collectScreen() {
    const ratio = window.devicePixelRatio;
    const resolution = `${screen.width} × ${screen.height}`;
    const refreshRateHz = await measureRefreshRate();
    portraitFacts.refreshRateHz = refreshRateHz;
    return [
        volatileRow(t('Refresh rate', 'Fréquence de rafraîchissement'), refreshRateHz ? `${refreshRateHz} Hz` : UNSUPPORTED, t('Measured by timing frames: 120 Hz and up gives away a gaming monitor or a recent laptop', 'Mesurée en chronométrant les images : 120 Hz et plus trahit un écran gamer ou un portable récent')),
        row(t('Screen resolution', 'Résolution de l\'écran'), resolution),
        row(t('Estimated physical resolution', 'Résolution physique estimée'), `${Math.round(screen.width * ratio)} × ${Math.round(screen.height * ratio)}`),
        row(t('Available area (excluding taskbar)', 'Zone disponible (hors barre des tâches)'), `${screen.availWidth} × ${screen.availHeight}`, t('Reveals the size and position of your taskbar / dock', 'Révèle la taille et la position de ta barre des tâches / ton dock')),
        row(t('Pixel density (zoom included)', 'Densité de pixels (zoom inclus)'), ratio),
        row(t('Color depth', 'Profondeur de couleur'), `${screen.colorDepth} bits`),
        volatileRow(t('Window size', 'Taille de la fenêtre'), `${window.outerWidth} × ${window.outerHeight}`),
        volatileRow(t('Viewport', 'Zone d\'affichage'), `${window.innerWidth} × ${window.innerHeight}`),
        volatileRow(t('Window position', 'Position de la fenêtre'), `${window.screenX}, ${window.screenY}`, t('A negative or very large position gives away a second screen', 'Une position négative ou très grande trahit un second écran')),
        row(t('Multiple screens', 'Plusieurs écrans'), screen.isExtended ?? UNSUPPORTED),
        row('Orientation', screen.orientation?.type ?? UNSUPPORTED),
        row(t('Color gamut', 'Gamut de couleurs'), firstMatchingMedia('color-gamut', ['rec2020', 'p3', 'srgb'])),
        row('HDR', matchesMedia('(dynamic-range: high)')),
    ];
}

function collectPreferences() {
    portraitFacts.prefersDarkMode = matchesMedia('(prefers-color-scheme: dark)');
    return [
        row(t('Theme', 'Thème'), firstMatchingMedia('prefers-color-scheme', ['dark', 'light'])),
        row(t('Reduced motion', 'Animations réduites'), matchesMedia('(prefers-reduced-motion: reduce)')),
        row(t('Contrast', 'Contraste'), firstMatchingMedia('prefers-contrast', ['more', 'less', 'custom', 'no-preference'])),
        row(t('Forced colors (high contrast)', 'Couleurs forcées (contraste élevé)'), matchesMedia('(forced-colors: active)')),
        row(t('Inverted colors', 'Couleurs inversées'), matchesMedia('(inverted-colors: inverted)')),
        row(t('Reduced transparency', 'Transparence réduite'), matchesMedia('(prefers-reduced-transparency: reduce)')),
        row(t('Data saver', 'Économie de données'), matchesMedia('(prefers-reduced-data: reduce)')),
    ];
}

async function collectLocale() {
    const dateTimeOptions = Intl.DateTimeFormat().resolvedOptions();
    const offsetMinutes = -new Date().getTimezoneOffset();
    const offsetLabel = `UTC${offsetMinutes >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMinutes) % 60).padStart(2, '0')}`;
    const ipGeolocation = await resolveIpGeolocation();
    const ipTimezone = ipGeolocation.status === 'success' ? ipGeolocation.timezone : undefined;
    const timezoneMismatch = ipTimezone && ipTimezone !== dateTimeOptions.timeZone;
    return [
        row(t('System time zone', 'Fuseau horaire du système'), dateTimeOptions.timeZone, timezoneMismatch ? t(`≠ your IP's time zone (${ipTimezone}): a classic sign of a VPN`, `≠ fuseau horaire de ton IP (${ipTimezone}) : signe classique d'un VPN`) : undefined),
        row(t('UTC offset', 'Décalage UTC'), offsetLabel),
        row(t('Locale', 'Paramètres régionaux'), dateTimeOptions.locale),
        row(t('Calendar', 'Calendrier'), dateTimeOptions.calendar),
        row(t('Numbering system', 'Système de numération'), dateTimeOptions.numberingSystem),
        row(t('Date format', 'Format de date'), new Date(2001, 11, 31, 23, 59).toLocaleString()),
        row(t('Number format', 'Format des nombres'), (1234567.891).toLocaleString()),
        volatileRow(t('Device local time', 'Heure locale de l\'appareil'), new Date().toString()),
    ];
}

async function collectKeyboard() {
    if (!navigator.keyboard?.getLayoutMap) {
        return [row(t('Keyboard layout', 'Disposition du clavier'), UNSUPPORTED, t('API only available on Chrome/Edge', 'API disponible uniquement sur Chrome/Edge'))];
    }
    const layoutMap = await navigator.keyboard.getLayoutMap();
    const topRow = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY'].map((code) => layoutMap.get(code)).join('');
    const layoutNames = { qwerty: 'QWERTY', azerty: 'AZERTY', qwertz: 'QWERTZ' };
    portraitFacts.keyboardLayout = layoutNames[topRow];
    return [
        row(t('Top row', 'Rangée du haut'), topRow),
        row(t('Detected layout', 'Disposition détectée'), layoutNames[topRow] ?? t('Other', 'Autre'), t('Without you pressing a single key', 'Sans que tu appuies sur une seule touche')),
    ];
}

function collectGpu() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
        return [row('WebGL', UNSUPPORTED)];
    }
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const extensions = gl.getSupportedExtensions() || [];
    return [
        row(t('Graphics card', 'Carte graphique'), renderer, t('The exact model of your GPU (and often its driver)', 'Le modèle exact de ton GPU (et souvent de son pilote)')),
        row(t('Vendor', 'Fabricant'), vendor),
        row(t('WebGL version', 'Version WebGL'), gl.getParameter(gl.VERSION)),
        row(t('GLSL version', 'Version GLSL'), gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
        row(t('Max texture size', 'Taille max. des textures'), gl.getParameter(gl.MAX_TEXTURE_SIZE)),
        row(t('Max viewport size', 'Taille max. du viewport'), Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)).join(' × ')),
        row(t('Max vertex attributes', 'Attributs de sommet max.'), gl.getParameter(gl.MAX_VERTEX_ATTRIBS)),
        row(t('Max anisotropy', 'Anisotropie max.'), readMaxAnisotropy(gl)),
        row(t('WebGL extensions', 'Extensions WebGL'), extensions),
        row(t('WebGL parameters fingerprint', 'Empreinte des paramètres WebGL'), hashText(extensions.join() + renderer + vendor)),
    ];
}

function readMaxAnisotropy(gl) {
    const extension = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    return extension ? gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : UNSUPPORTED;
}

async function collectWebGpu() {
    if (!navigator.gpu) {
        return [row('WebGPU', UNSUPPORTED)];
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        return [row(t('WebGPU adapter', 'Adaptateur WebGPU'), UNSUPPORTED, t('API present but no adapter available', 'API présente mais aucun adaptateur disponible'))];
    }
    const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
    return [
        row(t('Vendor', 'Fabricant'), orUnsupported(info.vendor)),
        row(t('GPU architecture', 'Architecture du GPU'), orUnsupported(info.architecture)),
        row(t('Device', 'Périphérique'), orUnsupported(info.device)),
        row('Description', orUnsupported(info.description)),
        row(t('Features', 'Fonctionnalités'), Array.from(adapter.features)),
        row(t('Max buffer size', 'Taille max. de tampon'), `${Math.round(adapter.limits.maxBufferSize / 1048576)} ${t('MB', 'Mo')}`),
    ];
}

function drawFingerprintCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 70;
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f60';
    ctx.fillRect(110, 2, 70, 22);
    ctx.font = '16px Arial';
    ctx.fillStyle = '#069';
    ctx.fillText('Fingerprint ✓ Ωπ 😃 <canvas>', 4, 6);
    ctx.font = '18px "Times New Roman"';
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('Fingerprint ✓ Ωπ 😃 <canvas>', 6, 30);
    ctx.globalCompositeOperation = 'multiply';
    [['#f0f', 220], ['#0ff', 245], ['#ff0', 232]].forEach(([color, x], index) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, 30 + index * 8, 22, 0, Math.PI * 2);
        ctx.fill();
    });
    return canvas.toDataURL();
}

function collectCanvas() {
    const firstRendering = drawFingerprintCanvas();
    const secondRendering = drawFingerprintCanvas();
    return [
        volatileRow(t('Rendering', 'Rendu'), { imageDataUrl: firstRendering }),
        row(t('Canvas fingerprint', 'Empreinte canvas'), hashText(firstRendering), t('The same drawing yields slightly different pixels depending on GPU, driver, OS and fonts', 'Le même dessin donne des pixels légèrement différents selon le GPU, le pilote, l\'OS et les polices')),
        row(t('Random noise injected', 'Bruit aléatoire injecté'), firstRendering !== secondRendering, t('If yes, your browser deliberately scrambles the canvas (Brave, Firefox RFP…)', 'Si oui, ton navigateur brouille volontairement le canvas (Brave, Firefox RFP…)')),
    ];
}

async function collectAudio() {
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineContext) {
        return [row('Web Audio', UNSUPPORTED)];
    }
    const context = new OfflineContext(1, 5000, 44100);
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 10000;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;
    oscillator.connect(compressor);
    compressor.connect(context.destination);
    oscillator.start(0);
    const buffer = await context.startRendering();
    const samples = buffer.getChannelData(0).slice(4500, 5000);
    const signalSum = samples.reduce((sum, sample) => sum + Math.abs(sample), 0);

    const liveContext = new (window.AudioContext || window.webkitAudioContext)();
    const rows = [
        row(t('Audio fingerprint', 'Empreinte audio'), signalSum.toString(), t('A sound generated silently: the result varies with the device\'s audio stack', 'Un son généré en silence : le résultat varie selon la pile audio de l\'appareil')),
        row(t('Sample rate', 'Fréquence d\'échantillonnage'), `${liveContext.sampleRate} Hz`),
        row(t('Base latency', 'Latence de base'), liveContext.baseLatency !== undefined ? `${(liveContext.baseLatency * 1000).toFixed(2)} ms` : UNSUPPORTED),
        row(t('Max output channels', 'Canaux de sortie max.'), liveContext.destination.maxChannelCount),
    ];
    liveContext.close();
    return rows;
}

function collectFonts() {
    const baseFonts = ['monospace', 'sans-serif', 'serif'];
    const candidateFonts = [
        'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia',
        'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
        'Malgun Gothic', 'Microsoft Sans Serif', 'MS Gothic', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI',
        'Segoe UI Emoji', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Yu Gothic',
        'Helvetica', 'Helvetica Neue', 'Avenir', 'Avenir Next', 'Futura', 'Geneva', 'Gill Sans', 'Lucida Grande', 'Menlo', 'Monaco',
        'Optima', 'San Francisco', 'SF Pro', 'Apple Color Emoji', 'Baskerville', 'Didot', 'Hoefler Text', 'Marker Felt',
        'DejaVu Sans', 'DejaVu Serif', 'Liberation Sans', 'Liberation Mono', 'Ubuntu', 'Ubuntu Mono', 'Cantarell', 'Noto Sans',
        'Noto Color Emoji', 'Droid Sans', 'Roboto', 'Open Sans', 'Lato', 'Fira Code', 'Fira Sans', 'Source Code Pro', 'JetBrains Mono',
        'Cascadia Code', 'Inter', 'Montserrat', 'Poppins', 'Bahnschrift', 'Book Antiqua', 'Century Gothic', 'Garamond', 'Wingdings',
        'Adobe Caslon Pro', 'Minion Pro', 'Myriad Pro', 'Calibri Light', 'Aptos', 'Agency FB', 'Rockwell', 'Papyrus',
    ];
    const probe = document.createElement('span');
    probe.textContent = 'mmmmmmmmmmlliWWW@#';
    probe.style.cssText = 'position:absolute;left:-9999px;font-size:72px;visibility:hidden';
    document.body.appendChild(probe);

    const measure = (fontFamily) => {
        probe.style.fontFamily = fontFamily;
        return `${probe.offsetWidth}x${probe.offsetHeight}`;
    };
    const baseSizes = Object.fromEntries(baseFonts.map((base) => [base, measure(base)]));
    const isInstalled = (font) => baseFonts.some((base) => measure(`"${font}", ${base}`) !== baseSizes[base]);
    const installedFonts = candidateFonts.filter(isInstalled);
    probe.remove();

    return [
        row(t('Fonts detected', 'Polices détectées'), `${installedFonts.length} / ${candidateFonts.length} ${t('tested', 'testées')}`, t('Office, Adobe or dev tools install very distinctive fonts', 'Office, Adobe ou les outils de dev installent des polices très reconnaissables')),
        row(t('List', 'Liste'), installedFonts),
        row(t('Fonts fingerprint', 'Empreinte des polices'), hashText(installedFonts.join())),
    ];
}

async function collectWebRtc() {
    const PeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!PeerConnection) {
        return [row('WebRTC', UNSUPPORTED)];
    }
    const connection = new PeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const candidates = [];
    connection.onicecandidate = (event) => {
        if (event.candidate?.candidate) {
            candidates.push(event.candidate.candidate);
        }
    };
    connection.createDataChannel('probe');
    await connection.setLocalDescription(await connection.createOffer());
    await wait(2500);
    connection.close();

    const describeCandidate = (candidate) => {
        const parts = candidate.split(' ');
        return { address: parts[4], type: parts[7] };
    };
    const parsedCandidates = candidates.map(describeCandidate);
    const addressesOfType = (type) => [...new Set(parsedCandidates.filter((candidate) => candidate.type === type).map((candidate) => candidate.address))];
    const publicAddresses = addressesOfType('srflx');
    const ipGeolocation = await resolveIpGeolocation();
    const vpnLeak = publicAddresses.length > 0 && ipGeolocation.status === 'success' && !publicAddresses.includes(ipGeolocation.query);
    return [
        row(t('Local addresses (host)', 'Adresses locales (host)'), addressesOfType('host').length ? addressesOfType('host') : UNSUPPORTED, t('Recent browsers hide the local IP behind a .local name', 'Les navigateurs récents cachent l\'IP locale derrière un nom en .local')),
        row(t('Public IP via STUN', 'IP publique via STUN'), publicAddresses.length ? publicAddresses : UNSUPPORTED, vpnLeak ? t('Differs from your detected public IP: likely WebRTC leak (VPN bypassed)', 'Différente de ton IP publique détectée : fuite WebRTC probable (VPN contourné)') : undefined),
        row(t('ICE candidates collected', 'Candidats ICE collectés'), candidates.length),
    ];
}

async function collectMediaDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) {
        return [row(t('Media devices', 'Périphériques multimédias'), UNSUPPORTED)];
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const countOfKind = (kind) => devices.filter((device) => device.kind === kind).length;
    const labels = devices.map((device) => device.label).filter(Boolean);
    return [
        row(t('Microphones', 'Micros'), countOfKind('audioinput')),
        row(t('Cameras', 'Caméras'), countOfKind('videoinput')),
        row(t('Audio outputs', 'Sorties audio'), countOfKind('audiooutput')),
        row(t('Device names', 'Noms des périphériques'), labels.length ? labels : UNSUPPORTED, t('Only visible after microphone/camera permission', 'Visibles seulement après autorisation micro/caméra')),
    ];
}

async function collectPermissions() {
    if (!navigator.permissions?.query) {
        return [row(t('Permissions API', 'API Permissions'), UNSUPPORTED)];
    }
    const permissionNames = [
        'geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read', 'clipboard-write', 'persistent-storage',
        'midi', 'accelerometer', 'gyroscope', 'magnetometer', 'background-sync', 'local-fonts', 'screen-wake-lock',
        'storage-access', 'window-management', 'idle-detection',
    ];
    const queryPermission = async (name) => {
        try {
            const status = await navigator.permissions.query({ name });
            return row(name, status.state);
        } catch {
            return row(name, UNSUPPORTED);
        }
    };
    return Promise.all(permissionNames.map(queryPermission));
}

async function collectStorageAndApis() {
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    const testStorage = (storageName) => {
        try {
            const storage = window[storageName];
            storage.setItem('__probe', '1');
            storage.removeItem('__probe');
            return true;
        } catch {
            return false;
        }
    };
    return [
        volatileRow(t('Storage quota', 'Quota de stockage'), estimate ? `${Math.round(estimate.quota / 1048576)} ${t('MB', 'Mo')}` : UNSUPPORTED, t('An unusually low quota often gives away private browsing', 'Un quota anormalement bas trahit souvent la navigation privée')),
        volatileRow(t('Storage used', 'Stockage utilisé'), estimate ? `${Math.round(estimate.usage / 1024)} ${t('KB', 'Ko')}` : UNSUPPORTED),
        row('localStorage', testStorage('localStorage')),
        row('sessionStorage', testStorage('sessionStorage')),
        row('IndexedDB', 'indexedDB' in window),
        row('Service Workers', 'serviceWorker' in navigator),
        row(t('Secure context', 'Contexte sécurisé'), window.isSecureContext),
        row('WebAssembly', typeof WebAssembly === 'object'),
        row('SharedArrayBuffer', typeof SharedArrayBuffer === 'function'),
        row('Bluetooth', 'bluetooth' in navigator),
        row('USB', 'usb' in navigator),
        row(t('Serial port', 'Port série'), 'serial' in navigator),
        row('HID', 'hid' in navigator),
        row(t('Native share', 'Partage natif'), 'share' in navigator),
        row(t('Payments', 'Paiements'), 'PaymentRequest' in window),
        row(t('Credentials (WebAuthn)', 'Identifiants (WebAuthn)'), 'PublicKeyCredential' in window),
    ];
}

async function collectBatteryAndConnection() {
    const connection = navigator.connection;
    const battery = navigator.getBattery ? await navigator.getBattery() : null;
    const isMainsPoweredWithoutBattery = battery && battery.level === 1 && battery.charging && battery.chargingTime === 0;
    if (battery && !isMainsPoweredWithoutBattery) {
        portraitFacts.battery = { levelPercent: Math.round(battery.level * 100), charging: battery.charging };
    }
    return [
        row(t('Network type', 'Type de réseau'), orUnsupported(connection?.type)),
        row(t('Estimated quality', 'Qualité estimée'), orUnsupported(connection?.effectiveType)),
        row(t('Estimated downlink', 'Débit descendant estimé'), connection?.downlink !== undefined ? `${connection.downlink} Mbps` : UNSUPPORTED),
        row(t('Estimated latency', 'Latence estimée'), connection?.rtt !== undefined ? `${connection.rtt} ms` : UNSUPPORTED),
        row(t('Data saver mode', 'Mode économie de données'), connection?.saveData ?? UNSUPPORTED),
        row(t('Battery level', 'Niveau de batterie'), battery ? `${Math.round(battery.level * 100)}%` : UNSUPPORTED, t('Long used to link two visits to the exact second', 'Longtemps utilisé pour relier deux visites à la seconde près')),
        row(t('Charging', 'En charge'), battery ? battery.charging : UNSUPPORTED),
        row(t('Time until empty', 'Autonomie restante'), battery && Number.isFinite(battery.dischargingTime) ? `${Math.round(battery.dischargingTime / 60)} min` : UNSUPPORTED),
    ];
}

async function collectVoices() {
    if (!window.speechSynthesis) {
        return [row(t('Speech synthesis', 'Synthèse vocale'), UNSUPPORTED)];
    }
    let voices = speechSynthesis.getVoices();
    if (!voices.length) {
        await Promise.race([new Promise((resolve) => { speechSynthesis.onvoiceschanged = resolve; }), wait(1500)]);
        voices = speechSynthesis.getVoices();
    }
    const localVoices = voices.filter((voice) => voice.localService);
    return [
        row(t('Available voices', 'Voix disponibles'), voices.length),
        row(t('Locally installed voices', 'Voix installées localement'), localVoices.map((voice) => `${voice.name} (${voice.lang})`)),
        row(t('Voices fingerprint', 'Empreinte des voix'), hashText(voices.map((voice) => voice.voiceURI).join())),
    ];
}

function collectMath() {
    const mathResults = [
        Math.tan(-1e300), Math.acosh(1e308), Math.asinh(1), Math.atanh(0.5), Math.expm1(1), Math.cbrt(100),
        Math.sinh(1), Math.cosh(10), Math.log1p(10), Math.exp(1e2), Math.pow(Math.PI, -100),
    ];
    return [
        row(t('Math function results', 'Résultats des fonctions Math'), mathResults.map(String)),
        row(t('Math fingerprint', 'Empreinte Math'), hashText(mathResults.join()), t('JavaScript engines round differently depending on browser and CPU', 'Les moteurs JavaScript arrondissent différemment selon le navigateur et le processeur')),
    ];
}

async function collectBotSignals() {
    const adBait = document.createElement('div');
    adBait.className = 'adsbox ad-banner advertisement pub_300x250';
    adBait.style.cssText = 'position:absolute;left:-9999px;height:10px;width:10px';
    adBait.innerHTML = '&nbsp;';
    document.body.appendChild(adBait);
    await wait(150);
    const adBlockerDetected = adBait.offsetHeight === 0 || getComputedStyle(adBait).display === 'none';
    adBait.remove();

    const notificationPermission = window.Notification ? Notification.permission : UNSUPPORTED;
    return [
        row(t('Ad blocker', 'Bloqueur de pubs'), adBlockerDetected),
        row('navigator.webdriver (Selenium, Puppeteer…)', navigator.webdriver ?? UNSUPPORTED),
        row(t('\"Headless\" User-Agent', 'User-Agent « headless »'), /Headless/i.test(navigator.userAgent)),
        row(t('Consistent window.chrome object', 'Objet window.chrome cohérent'), /Chrome/.test(navigator.userAgent) ? 'chrome' in window : UNSUPPORTED, t('Missing on a poorly disguised automated Chrome', 'Absent sur un Chrome automatisé mal déguisé')),
        row(t('No language declared', 'Aucune langue déclarée'), !navigator.languages || navigator.languages.length === 0),
        row(t('Zero-size outer window', 'Fenêtre extérieure de taille nulle'), window.outerWidth === 0 && window.outerHeight === 0),
        row(t('Notification permission', 'Permission des notifications'), notificationPermission),
        row(t('Automation variables', 'Variables d\'automatisation'), ['__nightmare', '_phantom', 'callPhantom', '__selenium_unwrapped', 'domAutomation'].filter((key) => key in window).join(', ') || t('none', 'aucune')),
    ];
}

const behaviour = {
    startedAt: performance.now(),
    mouseMoves: 0,
    mouseDistance: 0,
    lastPointer: null,
    clicks: 0,
    keyPresses: 0,
    keyIntervals: [],
    lastKeyAt: null,
    scrolls: 0,
    focusChanges: 0,
    straightLineMoves: 0,
};

function trackBehaviour() {
    window.addEventListener('mousemove', (event) => {
        if (behaviour.lastPointer) {
            const deltaX = event.clientX - behaviour.lastPointer.x;
            const deltaY = event.clientY - behaviour.lastPointer.y;
            behaviour.mouseDistance += Math.hypot(deltaX, deltaY);
            if (deltaX === 0 || deltaY === 0) {
                behaviour.straightLineMoves++;
            }
        }
        behaviour.lastPointer = { x: event.clientX, y: event.clientY };
        behaviour.mouseMoves++;
    });
    window.addEventListener('click', () => { behaviour.clicks++; });
    window.addEventListener('keydown', () => {
        const now = performance.now();
        if (behaviour.lastKeyAt !== null) {
            behaviour.keyIntervals.push(now - behaviour.lastKeyAt);
        }
        behaviour.lastKeyAt = now;
        behaviour.keyPresses++;
    });
    window.addEventListener('scroll', () => { behaviour.scrolls++; }, { passive: true });
    window.addEventListener('blur', () => { behaviour.focusChanges++; });
}

function collectBehaviour() {
    const elapsedSeconds = (performance.now() - behaviour.startedAt) / 1000;
    const averageKeyInterval = behaviour.keyIntervals.length
        ? `${Math.round(behaviour.keyIntervals.reduce((sum, interval) => sum + interval, 0) / behaviour.keyIntervals.length)} ms`
        : t('type a few keys', 'tape quelques touches');
    const straightRatio = behaviour.mouseMoves ? Math.round((behaviour.straightLineMoves / behaviour.mouseMoves) * 100) : 0;
    return [
        row(t('Time on page', 'Temps sur la page'), `${elapsedSeconds.toFixed(0)} s`),
        row(t('Mouse moves', 'Mouvements de souris'), behaviour.mouseMoves),
        row(t('Distance travelled', 'Distance parcourue'), `${Math.round(behaviour.mouseDistance)} px`),
        row(t('Perfectly straight moves', 'Mouvements parfaitement droits'), `${straightRatio}%`, t('Humans shake; scripts draw straight lines', 'Les humains tremblent ; les scripts tracent des lignes droites')),
        row(t('Last cursor position', 'Dernière position du curseur'), behaviour.lastPointer ? `${behaviour.lastPointer.x}, ${behaviour.lastPointer.y}` : t('move the mouse', 'bouge la souris')),
        row(t('Clicks', 'Clics'), behaviour.clicks),
        row(t('Key presses', 'Touches pressées'), behaviour.keyPresses),
        row(t('Average interval between keys', 'Intervalle moyen entre les touches'), averageKeyInterval, t('Your typing rhythm is almost as unique as a signature', 'Ton rythme de frappe est presque aussi unique qu\'une signature')),
        row(t('Scrolls', 'Défilements'), behaviour.scrolls),
        row(t('Tab / window switches', 'Changements d\'onglet / de fenêtre'), behaviour.focusChanges),
    ];
}

async function collectPreciseGeolocation() {
    if (!navigator.geolocation) {
        return [row(t('Geolocation', 'Géolocalisation'), UNSUPPORTED)];
    }
    const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 });
    });
    const { latitude, longitude, accuracy, altitude, speed } = position.coords;
    const ipGeolocation = await resolveIpGeolocation();
    const distanceFromIpKm = ipGeolocation?.status === 'success' ? haversineKm(latitude, longitude, ipGeolocation.lat, ipGeolocation.lon) : null;
    return [
        row('Latitude / longitude', `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`),
        row(t('Accuracy', 'Précision'), `± ${Math.round(accuracy)} m`, t('With Wi-Fi, often your exact address', 'Avec le Wi-Fi, souvent ton adresse exacte')),
        row('Altitude', altitude !== null ? `${Math.round(altitude)} m` : UNSUPPORTED),
        row(t('Speed', 'Vitesse'), speed !== null ? `${speed} m/s` : UNSUPPORTED),
        row(t('Distance from IP location', 'Distance avec la position de l\'IP'), distanceFromIpKm !== null ? `${distanceFromIpKm.toFixed(1)} km` : UNSUPPORTED),
        row(t('Map', 'Carte'), { mapEmbedUrl: buildOpenStreetMapEmbedUrl(latitude, longitude) }),
    ];
}

function buildOpenStreetMapEmbedUrl(latitude, longitude) {
    const halfSpanDegrees = 0.004;
    const boundingBox = [
        longitude - halfSpanDegrees, latitude - halfSpanDegrees, longitude + halfSpanDegrees, latitude + halfSpanDegrees,
    ].join(',');
    return `https://www.openstreetmap.org/export/embed.html?bbox=${boundingBox}&layer=mapnik&marker=${latitude},${longitude}`;
}

function haversineKm(latitudeA, longitudeA, latitudeB, longitudeB) {
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const deltaLatitude = toRadians(latitudeB - latitudeA);
    const deltaLongitude = toRadians(longitudeB - longitudeA);
    const a = Math.sin(deltaLatitude / 2) ** 2
        + Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) * Math.sin(deltaLongitude / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function detectPrivateBrowsing() {
    const DEFAULT_HEAP_LIMIT_BYTES = 1073741824;
    const isChromium = Boolean(navigator.userAgentData) || /Chrome\//.test(navigator.userAgent);
    if (isChromium && navigator.storage?.estimate) {
        const { quota } = await navigator.storage.estimate();
        const privateQuotaCeiling = (performance.memory?.jsHeapSizeLimit ?? DEFAULT_HEAP_LIMIT_BYTES) * 2;
        return { isPrivate: quota < privateQuotaCeiling, clue: t(`Storage quota of ${Math.round(quota / 1048576)} MB: incognito gets a small in-memory quota`, `Quota de stockage de ${Math.round(quota / 1048576)} Mo : la navigation privée reçoit un petit quota en mémoire`) };
    }
    if (/Firefox\//.test(navigator.userAgent) && !('serviceWorker' in navigator)) {
        return { isPrivate: true, clue: t('Service workers are disabled: Firefox does that in private windows', 'Les service workers sont désactivés : Firefox fait ça en fenêtre privée') };
    }
    if (navigator.storage?.getDirectory) {
        try {
            await navigator.storage.getDirectory();
            return { isPrivate: false, clue: t('Persistent file storage is available', 'Le stockage de fichiers persistant est disponible') };
        } catch (error) {
            return { isPrivate: true, clue: t(`Persistent file storage refused (${error.name}): typical of a private window`, `Stockage de fichiers persistant refusé (${error.name}) : typique d'une fenêtre privée`) };
        }
    }
    return { isPrivate: null, clue: t('No reliable test for this browser', 'Aucun test fiable pour ce navigateur') };
}

async function collectPrivateBrowsing() {
    const { isPrivate, clue } = await detectPrivateBrowsing();
    portraitFacts.isPrivateBrowsing = isPrivate === true;
    const describeVerdict = () => {
        if (isPrivate === null) {
            return UNSUPPORTED;
        }
        return isPrivate ? t('Probably yes', 'Probablement oui') : t('Probably not', 'Probablement pas');
    };
    return [
        row(t('Private / incognito window', 'Fenêtre privée / incognito'), describeVerdict(), clue),
        row(t('Does it hide you from this page?', 'Te cache-t-elle de cette page ?'), t('No', 'Non'), t('It only forgets cookies and history when you close it. Your fingerprint stays the same.', 'Elle oublie seulement les cookies et l\'historique à la fermeture. Ton empreinte reste la même.')),
    ];
}

const KNOWN_EXTENSION_TRACES = [
    ['Grammarly', () => document.body.hasAttribute('data-gr-ext-installed') || document.body.hasAttribute('data-new-gr-c-s-check-loaded')],
    ['Dark Reader', () => document.documentElement.hasAttribute('data-darkreader-mode') || document.querySelector('meta[name="darkreader"]') !== null],
    ['ColorZilla', () => document.body.hasAttribute('cz-shortcut-listen')],
    ['React Developer Tools', () => Boolean(window.__REACT_DEVTOOLS_GLOBAL_HOOK__)],
    ['Vue.js devtools', () => Boolean(window.__VUE_DEVTOOLS_GLOBAL_HOOK__)],
    ['Redux DevTools', () => Boolean(window.__REDUX_DEVTOOLS_EXTENSION__)],
    ['MetaMask', () => Boolean(window.ethereum?.isMetaMask)],
    ['Phantom', () => Boolean(window.phantom?.solana)],
    [t('A crypto wallet', 'Un portefeuille crypto'), () => Boolean(window.ethereum) && !window.ethereum.isMetaMask],
];

async function collectExtensions() {
    const EXTENSION_INJECTION_DELAY_MS = 1500;
    await wait(EXTENSION_INJECTION_DELAY_MS);
    const detectedExtensions = KNOWN_EXTENSION_TRACES.filter(([, isPresent]) => isPresent()).map(([name]) => name);
    portraitFacts.extensions = detectedExtensions;
    return [
        row(t('Detected extensions', 'Extensions détectées'), detectedExtensions, t('Only extensions that leave traces in the page can be spotted this way', 'Seules les extensions qui laissent des traces dans la page peuvent être repérées ainsi')),
        row(t('Extensions looked for', 'Extensions recherchées'), KNOWN_EXTENSION_TRACES.map(([name]) => name)),
    ];
}

const GOOGLE_LOGIN_PROBE_URL = 'https://accounts.google.com/ServiceLogin?continue=https://www.google.com/favicon.ico';

function probeGoogleLogin() {
    const PROBE_TIMEOUT_MS = 4000;
    return new Promise((resolve) => {
        const probe = new Image();
        const timeout = setTimeout(() => resolve('timeout'), PROBE_TIMEOUT_MS);
        const settle = (outcome) => {
            clearTimeout(timeout);
            resolve(outcome);
        };
        probe.referrerPolicy = 'no-referrer';
        probe.onload = () => settle('loaded');
        probe.onerror = () => settle('failed');
        probe.src = GOOGLE_LOGIN_PROBE_URL;
    });
}

async function collectGoogleLogin() {
    const outcome = await probeGoogleLogin();
    portraitFacts.isLoggedInToGoogle = outcome === 'loaded';
    const verdicts = {
        loaded: t('Probably yes', 'Probablement oui'),
        failed: t('Not logged in, or your browser blocks this trick', 'Pas de session Google, ou ton navigateur bloque cette astuce'),
        timeout: t('Test timed out', 'Le test a expiré'),
    };
    return [
        row(t('Logged in to a Google account', 'Session Google ouverte'), verdicts[outcome], t('Experimental: blocked by Firefox, Safari and private windows, uncertain on Chrome', 'Expérimental : bloqué par Firefox, Safari et les fenêtres privées, incertain sur Chrome')),
        row(t('How', 'Comment'), t('An invisible image points to Google\'s login page, which redirects to the Google logo only if you are logged in. The page just watches whether the image loads.', 'Une image invisible pointe vers la page de connexion de Google, qui ne redirige vers le logo Google que si ta session est ouverte. La page regarde simplement si l\'image se charge.')),
    ];
}

function collectWhatWeCannotSee() {
    return [
        row(t('Your other tabs (addresses, titles, how many)', 'Tes autres onglets (adresses, titres, nombre)'), t('Hidden', 'Hors de portée'), t('Only browser extensions can see them', 'Seules les extensions du navigateur peuvent les voir')),
        row(t('The list of sites you visited', 'La liste des sites que tu as visités'), t('Hidden', 'Hors de portée'), t('Browsers now lie about visited-link colors and isolate their cache per site', 'Les navigateurs mentent désormais sur la couleur des liens visités et isolent leur cache par site')),
        row(t('Whether you are logged in to Facebook, Gmail…', 'Tes sessions ouvertes sur Facebook, Gmail…'), t('Mostly hidden', 'Le plus souvent hors de portée'), t('Used to leak through redirect tricks; modern cookie rules block most of them', 'Ça fuitait via des astuces de redirection ; les règles modernes sur les cookies en bloquent la plupart')),
        row(t('Your files', 'Tes fichiers'), t('Hidden', 'Hors de portée'), t('Unless you pick one or drop it on the page', 'Sauf si tu en choisis un ou le déposes sur la page')),
        row(t('Your clipboard', 'Ton presse-papiers'), t('Hidden', 'Hors de portée'), t('Unless you paste on the page, as the toasts showed you', 'Sauf si tu colles sur la page, comme les notifications te l\'ont montré')),
        row(t('Your camera, microphone and exact location', 'Ta caméra, ton micro et ta position exacte'), t('Only with your permission', 'Seulement avec ton autorisation'), t('Hence the button in the GPS block', 'D\'où le bouton dans le bloc GPS')),
        row(t('Your name, email and accounts', 'Ton nom, ton e-mail et tes comptes'), t('Hidden', 'Hors de portée'), t('Unless you type them, or a hidden form tricks your password manager into filling them', 'Sauf si tu les tapes, ou qu\'un formulaire caché pousse ton gestionnaire de mots de passe à les remplir')),
        row(t('Other apps running on your computer', 'Les autres applis ouvertes sur ton ordinateur'), t('Hidden', 'Hors de portée'), t('Installed fonts and extensions are the only indirect clues', 'Les polices et extensions installées sont les seuls indices indirects')),
        row(t('What you type in other tabs or apps', 'Ce que tu tapes dans d\'autres onglets ou applis'), t('Hidden', 'Hors de portée'), t('Keys are only reported while this page has focus', 'Les touches ne sont signalées que quand cette page a le focus')),
        row(t('Devices on your home network', 'Les appareils de ton réseau local'), t('Mostly hidden', 'Le plus souvent hors de portée'), t('Browsers increasingly block pages from reaching local addresses', 'Les navigateurs empêchent de plus en plus les pages d\'atteindre les adresses locales')),
        row(t('Hardware serial numbers, MAC address', 'Numéros de série du matériel, adresse MAC'), t('Hidden', 'Hors de portée'), t('Never exposed to web pages', 'Jamais exposés aux pages web')),
    ];
}

/* ---------- Sections ---------- */

const sections = [
    { anchor: 'network-ip-and-internet-provider', title: t('Network, IP and internet provider', 'Réseau, IP et fournisseur d\'accès'), why: t('Visible to every website, even without JavaScript. Pins down your city and ISP; anti-bot systems score the IP\'s reputation.', 'Visible par tous les sites, même sans JavaScript. Situe ta ville et ton FAI ; les systèmes anti-bots notent la réputation de l\'IP.'), collect: collectNetwork },
    { anchor: 'browser-and-system', title: t('Browser and system', 'Navigateur et système'), why: t('Exact browser and OS version: the base of every fingerprint and the first anti-bot filter.', 'Version exacte du navigateur et de l\'OS : la base de toute empreinte et le premier filtre anti-bot.'), collect: collectBrowserAndOs, fingerprint: true },
    { anchor: 'private-browsing', title: t('Private browsing', 'Navigation privée'), why: t('Websites can usually tell when you are in a private window, and it does not change your fingerprint.', 'Les sites savent généralement quand tu es en fenêtre privée, et ça ne change pas ton empreinte.'), collect: collectPrivateBrowsing },
    { anchor: 'google-account-experimental', title: t('Google account (experimental)', 'Compte Google (expérimental)'), why: t('An old trick that tells whether you are logged in to Google, without reading anything from Google.', 'Une vieille astuce qui révèle si ta session Google est ouverte, sans rien lire chez Google.'), collect: collectGoogleLogin },
    { anchor: 'browser-extensions', title: t('Browser extensions', 'Extensions du navigateur'), why: t('Many extensions change the page or add objects to it, and give themselves away.', 'Beaucoup d\'extensions modifient la page ou y ajoutent des objets, et se trahissent.'), collect: collectExtensions },
    { anchor: 'hardware', title: t('Hardware', 'Matériel'), why: t('Core count, memory, touch screen: sharply narrows down the possible devices.', 'Nombre de cœurs, mémoire, écran tactile : réduit fortement la liste des appareils possibles.'), collect: collectHardware, fingerprint: true },
    { anchor: 'screen-and-window', title: t('Screen and window', 'Écran et fenêtre'), why: t('Resolution, zoom, taskbar, second screen: highly distinctive combined with the rest.', 'Résolution, zoom, barre des tâches, second écran : très distinctif combiné au reste.'), collect: collectScreen, fingerprint: true },
    { anchor: 'graphics-card-webgl', title: t('Graphics card (WebGL)', 'Carte graphique (WebGL)'), why: t('The exact model of your GPU, readable by any page.', 'Le modèle exact de ton GPU, lisible par n\'importe quelle page.'), collect: collectGpu, fingerprint: true },
    { anchor: 'graphics-card-webgpu', title: t('Graphics card (WebGPU)', 'Carte graphique (WebGPU)'), why: t('A recent API that reveals the GPU architecture.', 'Une API récente qui révèle l\'architecture du GPU.'), collect: collectWebGpu, fingerprint: true },
    { anchor: 'canvas-fingerprint', title: t('Canvas fingerprint', 'Empreinte canvas'), why: t('Tracking technique #1: an invisible drawing whose pixels vary from one machine to another.', 'Technique de pistage n° 1 : un dessin invisible dont les pixels varient d\'une machine à l\'autre.'), collect: collectCanvas, fingerprint: true },
    { anchor: 'audio-fingerprint', title: t('Audio fingerprint', 'Empreinte audio'), why: t('Same idea as the canvas, with a sound that is computed but never played.', 'Même idée que le canvas, avec un son calculé mais jamais joué.'), collect: collectAudio, fingerprint: true },
    { anchor: 'installed-fonts', title: t('Installed fonts', 'Polices installées'), why: t('Inferred by measuring the width of some text, without any permission.', 'Déduites en mesurant la largeur d\'un texte, sans aucune permission.'), collect: collectFonts, fingerprint: true },
    { anchor: 'language-time-zone-and-formats', title: t('Language, time zone and formats', 'Langue, fuseau horaire et formats'), why: t('Compared with the IP, a mismatched time zone gives away a VPN.', 'Comparé à l\'IP, un fuseau horaire incohérent trahit un VPN.'), collect: collectLocale, fingerprint: true },
    { anchor: 'keyboard', title: t('Keyboard', 'Clavier'), why: t('Your keyboard layout, without a single keystroke.', 'Ta disposition de clavier, sans une seule frappe.'), collect: collectKeyboard, fingerprint: true },
    { anchor: 'display-preferences', title: t('Display preferences', 'Préférences d\'affichage'), why: t('Dark theme, accessibility: personal settings that add entropy.', 'Thème sombre, accessibilité : des réglages personnels qui ajoutent de l\'entropie.'), collect: collectPreferences, fingerprint: true },
    { anchor: 'javascript-engine', title: t('JavaScript engine', 'Moteur JavaScript'), why: t('How math functions round identifies the engine, and sometimes the CPU.', 'La façon dont les fonctions mathématiques arrondissent identifie le moteur, et parfois le processeur.'), collect: collectMath, fingerprint: true },
    { anchor: 'speech-synthesis', title: t('Speech synthesis', 'Synthèse vocale'), why: t('Installed voices depend on the OS, its language and installed packs.', 'Les voix installées dépendent de l\'OS, de sa langue et des packs installés.'), collect: collectVoices, fingerprint: true },
    { anchor: 'webrtc', title: t('WebRTC', 'WebRTC'), why: t('Can reveal your real public IP, even behind some VPNs.', 'Peut révéler ta vraie IP publique, même derrière certains VPN.'), collect: collectWebRtc },
    { anchor: 'media-devices', title: t('Media devices', 'Périphériques multimédias'), why: t('Number of microphones, cameras and audio outputs, without asking for access.', 'Nombre de micros, caméras et sorties audio, sans demander l\'accès.'), collect: collectMediaDevices, fingerprint: true },
    { anchor: 'permissions', title: t('Permissions', 'Permissions'), why: t('What you have already granted or denied to this site.', 'Ce que tu as déjà accordé ou refusé à ce site.'), collect: collectPermissions },
    { anchor: 'storage-and-available-apis', title: t('Storage and available APIs', 'Stockage et API disponibles'), why: t('Supported features sketch the exact browser profile.', 'Les fonctionnalités prises en charge dessinent le profil exact du navigateur.'), collect: collectStorageAndApis, fingerprint: true },
    { anchor: 'connection-and-battery', title: t('Connection and battery', 'Connexion et batterie'), why: t('Connection type, bandwidth and battery status.', 'Type de connexion, bande passante et état de la batterie.'), collect: collectBatteryAndConnection },
    { anchor: 'anti-bot-signals', title: t('Anti-bot signals', 'Signaux anti-bot'), why: t('What reCAPTCHA, Turnstile or hCaptcha check to tell a human from a bot.', 'Ce que vérifient reCAPTCHA, Turnstile ou hCaptcha pour distinguer un humain d\'un bot.'), collect: collectBotSignals },
    { anchor: 'behaviour-live', title: t('Behaviour (live)', 'Comportement (en direct)'), why: t('Invisible CAPTCHAs analyse your mouse, keyboard and rhythm. Move, type, scroll.', 'Les CAPTCHA invisibles analysent ta souris, ton clavier et ton rythme. Bouge, tape, fais défiler.'), collect: collectBehaviour, live: true },
    { anchor: 'precise-gps-location', title: t('Precise GPS location', 'Position GPS précise'), why: t('Requires your explicit consent — but many people click \"Allow\" without thinking.', 'Nécessite ton accord explicite — mais beaucoup de gens cliquent sur « Autoriser » sans réfléchir.'), collect: collectPreciseGeolocation, onDemand: t('Locate me precisely', 'Me localiser précisément') },
    { anchor: 'http-headers', title: t('HTTP headers', 'En-têtes HTTP'), why: t('Sent automatically with every request, before the page even renders.', 'Envoyés automatiquement avec chaque requête, avant même que la page s\'affiche.'), collect: collectHttpHeaders, requiresServer: true },
    { anchor: 'what-we-can-t-see', title: t('What we can\'t see', 'Ce qu\'on ne peut pas voir'), why: t('Browsers have closed many of the old leaks. Here is what this page cannot learn about you.', 'Les navigateurs ont colmaté beaucoup des anciennes fuites. Voici ce que cette page ne peut pas apprendre sur toi.'), collect: collectWhatWeCannotSee, reassuring: true },
];

/* ---------- Rendering ---------- */

function renderValue(value) {
    const cell = document.createElement('span');
    if (value === UNSUPPORTED) {
        cell.className = 'unsupported';
        cell.textContent = t('not exposed', 'non exposé');
    } else if (typeof value === 'boolean') {
        cell.className = value ? 'yes' : 'no';
        cell.textContent = value ? t('yes', 'oui') : t('no', 'non');
    } else if (Array.isArray(value)) {
        return renderList(value);
    } else if (typeof value === 'object' && value?.imageDataUrl) {
        const image = document.createElement('img');
        image.src = value.imageDataUrl;
        image.className = 'canvas-preview';
        image.alt = t('Canvas rendering used for the fingerprint', 'Rendu canvas utilisé pour l\'empreinte');
        return image;
    } else if (typeof value === 'object' && value?.mapEmbedUrl) {
        const map = document.createElement('iframe');
        map.src = value.mapEmbedUrl;
        map.className = 'map-embed';
        map.title = t('Your location on OpenStreetMap', 'Ta position sur OpenStreetMap');
        map.loading = 'lazy';
        return map;
    } else {
        cell.textContent = String(value);
    }
    return cell;
}

function renderList(items) {
    if (items.length === 0) {
        const empty = document.createElement('span');
        empty.textContent = t('none', 'aucun');
        return empty;
    }
    if (items.length <= 6) {
        const inline = document.createElement('span');
        inline.textContent = items.join(', ');
        return inline;
    }
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${items.length} ${t('items', 'éléments')}`;
    const list = document.createElement('ul');
    items.forEach((item) => {
        const listItem = document.createElement('li');
        listItem.textContent = item;
        list.appendChild(listItem);
    });
    details.append(summary, list);
    return details;
}

function renderRows(container, rows) {
    const table = document.createElement('table');
    rows.forEach(({ label, value, note }) => {
        const tableRow = table.insertRow();
        tableRow.insertCell().textContent = label;
        const valueCell = tableRow.insertCell();
        valueCell.appendChild(renderValue(value));
        if (note) {
            const noteElement = document.createElement('span');
            noteElement.className = 'note';
            noteElement.textContent = note;
            valueCell.appendChild(noteElement);
        }
    });
    container.replaceChildren(table);
}

function renderError(container, error) {
    const errorElement = document.createElement('div');
    errorElement.className = 'state-error';
    errorElement.textContent = `${t('Collection failed:', 'Échec de la collecte :')} ${error.message || error}`;
    container.replaceChildren(errorElement);
}

function sectionAnchorId(section) {
    return `section-${section.anchor}`;
}

function createCard(section) {
    const card = document.createElement('details');
    card.className = 'card';
    card.id = sectionAnchorId(section);
    const header = document.createElement('summary');
    header.className = 'card-header';
    const title = document.createElement('h2');
    title.textContent = section.title;
    const why = document.createElement('p');
    why.className = 'why';
    why.textContent = section.why;
    const body = document.createElement('div');
    body.className = 'state-loading';
    body.textContent = t('Collecting…', 'Collecte…');
    header.append(title, why);
    card.append(header, body);
    document.getElementById('sections').appendChild(card);
    return { card, body };
}

async function runSection(section, body) {
    try {
        const rows = await withTimeout(Promise.resolve().then(section.collect), SECTION_TIMEOUT_MS, t('timed out', 'délai dépassé'));
        body.className = '';
        renderRows(body, rows);
        return rows;
    } catch (error) {
        console.error(`Section "${section.title}" failed`, error);
        body.className = '';
        renderError(body, error);
        return null;
    }
}

function attachOnDemandButton(section, card, body) {
    body.className = '';
    body.textContent = '';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const button = document.createElement('button');
    button.textContent = section.onDemand;
    const requestCollection = async () => {
        button.disabled = true;
        body.className = 'state-loading';
        body.textContent = t('Waiting for your permission…', 'En attente de ton autorisation…');
        try {
            const rows = await section.collect();
            body.className = '';
            renderRows(body, rows);
        } catch (error) {
            console.error(`Section "${section.title}" failed`, error);
            body.className = '';
            renderError(body, error);
        }
        button.disabled = false;
    };
    button.addEventListener('click', requestCollection);
    actions.appendChild(button);
    card.insertBefore(actions, body);
}

const FINGERPRINT_COMPONENTS_STORAGE_KEY = 'previousFingerprintComponents';

function serialiseFingerprintValue(value) {
    if (value === UNSUPPORTED) {
        return '-';
    }
    return JSON.stringify(Array.isArray(value) ? [...value].sort() : value);
}

function serialiseFingerprintComponents(fingerprintResults) {
    const components = {};
    fingerprintResults.forEach(({ section, rows }) => {
        if (rows === null) {
            components[section.title] = 'collection failed';
            return;
        }
        rows
            .filter((fingerprintRow) => !fingerprintRow.volatile)
            .forEach(({ label, value }) => {
                components[`${section.title} › ${label}`] = serialiseFingerprintValue(value);
            });
    });
    return components;
}

function readPreviousFingerprintComponents() {
    try {
        return JSON.parse(sessionStorage.getItem(FINGERPRINT_COMPONENTS_STORAGE_KEY));
    } catch (error) {
        console.error('Cannot read previous fingerprint components', error);
        return null;
    }
}

function savePreviousFingerprintComponents(components) {
    try {
        sessionStorage.setItem(FINGERPRINT_COMPONENTS_STORAGE_KEY, JSON.stringify(components));
    } catch (error) {
        console.error('Cannot save fingerprint components', error);
    }
}

function listChangedComponents(previousComponents, components) {
    const names = new Set([...Object.keys(previousComponents), ...Object.keys(components)]);
    return [...names].filter((name) => previousComponents[name] !== components[name]);
}

function renderFingerprintStability(container, previousComponents, components) {
    const stability = document.createElement('div');
    stability.className = 'why';
    if (!previousComponents) {
        stability.textContent = t('Reload the page (F5): characteristics that change between two loads will be listed here.', 'Recharge la page (F5) : les caractéristiques qui changent entre deux chargements seront listées ici.');
        container.appendChild(stability);
        return;
    }
    const changedComponents = listChangedComponents(previousComponents, components);
    if (changedComponents.length === 0) {
        stability.textContent = t('Identical to the previous load.', 'Identique au chargement précédent.');
        container.appendChild(stability);
        return;
    }
    stability.textContent = t(`${changedComponents.length} characteristic(s) changed since the previous load:`, `${changedComponents.length} caractéristique(s) modifiée(s) depuis le chargement précédent :`);
    const changes = document.createElement('ul');
    changes.className = 'fingerprint-changes';
    changedComponents.forEach((name) => {
        const change = document.createElement('li');
        change.textContent = `${name}: ${previousComponents[name] ?? t('(missing)', '(absent)')} → ${components[name] ?? t('(missing)', '(absent)')}`;
        changes.appendChild(change);
    });
    container.append(stability, changes);
}

function hashFingerprintComponents(components) {
    const serialisable = Object.entries(components).map(([name, value]) => `${name}=${value}`);
    return hashText(serialisable.join('|'));
}

function renderFingerprint(components, fingerprintHash) {
    const container = document.getElementById('fingerprint');
    container.replaceChildren();
    const intro = document.createElement('div');
    intro.textContent = t(`Your fingerprint, computed from ${Object.keys(components).length} stable characteristics (no cookie, no IP):`, `Ton empreinte, calculée à partir de ${Object.keys(components).length} caractéristiques stables (sans cookie, sans IP) :`);
    const hash = document.createElement('div');
    hash.className = 'hash';
    hash.textContent = fingerprintHash;
    const explanation = document.createElement('div');
    explanation.className = 'why';
    explanation.textContent = t('Reload the page, go incognito, clear your cookies: this code usually stays the same. '
        + 'A website can recognise you without storing anything on your device.',
    'Recharge la page, passe en navigation privée, efface tes cookies : ce code reste généralement le même. '
        + 'Un site peut te reconnaître sans rien stocker sur ton appareil.');
    container.append(intro, hash, explanation);
    renderFingerprintStability(container, readPreviousFingerprintComponents(), components);
    savePreviousFingerprintComponents(components);
}

function renderSectionMenu(availableSections) {
    const createMenuLink = (label, anchorId) => {
        const link = document.createElement('a');
        link.href = `#${anchorId}`;
        link.textContent = label;
        link.addEventListener('click', () => expandAnchoredBlock(anchorId));
        return link;
    };
    const fingerprintLink = createMenuLink(t('Your fingerprint', 'Ton empreinte'), 'fingerprint');
    const createSectionLink = (section) => createMenuLink(section.title, sectionAnchorId(section));
    const createReassuringLink = (section) => {
        const link = createSectionLink(section);
        link.classList.add('is-reassuring');
        return link;
    };
    const lineBreak = document.createElement('span');
    lineBreak.className = 'section-menu-break';
    const regularLinks = availableSections.filter((section) => !section.reassuring).map(createSectionLink);
    const reassuringLinks = availableSections.filter((section) => section.reassuring).map(createReassuringLink);
    const sectionLinks = reassuringLinks.length ? [...regularLinks, lineBreak, ...reassuringLinks] : regularLinks;
    document.getElementById('section-menu').replaceChildren(fingerprintLink, ...sectionLinks);
}

function expandAnchoredBlock(anchorId) {
    const anchoredBlock = document.getElementById(anchorId);
    if (anchoredBlock instanceof HTMLDetailsElement) {
        anchoredBlock.open = true;
    }
    return anchoredBlock;
}

function expandBlockFromUrlHash() {
    const anchorId = decodeURIComponent(window.location.hash.slice(1));
    return anchorId ? expandAnchoredBlock(anchorId) : null;
}

const TOAST_DURATION_MS = 2500;
const MAX_VISIBLE_TOASTS = 4;
const EXCERPT_MAX_LENGTH = 40;

function showToast(message, { evenInGameMode = false } = {}) {
    // In game mode (playing or game over) toasts would only clutter the screen.
    if (!evenInGameMode && document.body.classList.contains('is-game-mode')) {
        return;
    }
    const toasts = document.getElementById('toasts');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toasts.appendChild(toast);
    while (toasts.childElementCount > MAX_VISIBLE_TOASTS) {
        toasts.firstElementChild.remove();
    }
    setTimeout(() => toast.remove(), TOAST_DURATION_MS);
}

function excerpt(text) {
    const singleLine = text.replace(/\s+/g, ' ').trim();
    return singleLine.length > EXCERPT_MAX_LENGTH ? `${singleLine.slice(0, EXCERPT_MAX_LENGTH)}…` : singleLine;
}

function formatDuration(milliseconds) {
    const totalSeconds = Math.round(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? `${minutes} min ${seconds} s` : `${seconds} s`;
}

function watchTextSelection() {
    const SETTLE_DELAY_MS = 700;
    let settleTimer = null;
    let lastReportedSelection = '';
    const reportSettledSelection = () => {
        const selectedText = window.getSelection().toString().trim();
        if (selectedText && selectedText !== lastReportedSelection) {
            showToast(t(`You selected "${excerpt(selectedText)}".`, `Tu as sélectionné « ${excerpt(selectedText)} ».`));
        }
        lastReportedSelection = selectedText;
    };
    document.addEventListener('selectionchange', () => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(reportSettledSelection, SETTLE_DELAY_MS);
    });
}

function watchPaste() {
    const reportPaste = (event) => {
        const pastedText = event.clipboardData?.getData('text') ?? '';
        if (pastedText.trim()) {
            showToast(t(`You pasted "${excerpt(pastedText)}".`, `Tu as collé « ${excerpt(pastedText)} ».`));
        } else if (event.clipboardData?.files.length) {
            showToast(t(`You pasted ${event.clipboardData.files.length} file(s).`, `Tu as collé ${event.clipboardData.files.length} fichier(s).`));
        }
    };
    document.addEventListener('paste', reportPaste);
}

function watchAbsence() {
    let awaySince = null;
    let awayKind = null;
    const markAway = (kind) => {
        awaySince ??= performance.now();
        awayKind = kind;
    };
    const reportReturn = () => {
        if (awaySince === null) {
            return;
        }
        const awayDuration = formatDuration(performance.now() - awaySince);
        showToast(awayKind === 'tab'
            ? t(`You switched tab for ${awayDuration}. Welcome back.`, `Tu as changé d'onglet pendant ${awayDuration}. Bon retour.`)
            : t(`You switched to another window for ${awayDuration}.`, `Passage sur une autre fenêtre pendant ${awayDuration}.`));
        awaySince = null;
    };
    window.addEventListener('blur', () => markAway('window'));
    window.addEventListener('focus', reportReturn);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            markAway('tab');
        } else {
            reportReturn();
        }
    });
}

async function watchCharger() {
    if (!navigator.getBattery) {
        return;
    }
    try {
        const battery = await navigator.getBattery();
        const reportChargerChange = () => showToast(battery.charging ? t('You plugged in your charger.', 'Tu as branché ton chargeur.') : t('You unplugged your charger.', 'Tu as débranché ton chargeur.'));
        battery.addEventListener('chargingchange', reportChargerChange);
    } catch (error) {
        console.error('Cannot watch charger', error);
    }
}

function watchMediaDevices() {
    if (!navigator.mediaDevices) {
        return;
    }
    const reportDeviceChange = () => showToast(t('A device was plugged in or unplugged (headphones, mic, camera…).', 'Un appareil a été branché ou débranché (casque, micro, caméra…).'));
    navigator.mediaDevices.addEventListener('devicechange', reportDeviceChange);
}

function watchExitIntent() {
    const MIN_INTERVAL_MS = 10000;
    let lastReportedAt = -Infinity;
    const reportExitIntent = (event) => {
        const isLeavingThroughTop = event.relatedTarget === null && event.clientY <= 0;
        if (isLeavingThroughTop && performance.now() - lastReportedAt > MIN_INTERVAL_MS) {
            lastReportedAt = performance.now();
            showToast(t('Leaving already?', 'Tu pars déjà ?'));
        }
    };
    document.addEventListener('mouseout', reportExitIntent);
}

function watchScreenshotShortcuts() {
    const MAC_SCREENSHOT_KEY_CODES = ['Digit3', 'Digit4', 'Digit5'];
    const isScreenshotShortcut = (event) => event.metaKey && event.shiftKey
        && (MAC_SCREENSHOT_KEY_CODES.includes(event.code) || event.code === 'KeyS');
    const reportScreenshot = () => showToast(t('Taking a screenshot?', 'Une capture d\'écran ?'));
    window.addEventListener('keydown', (event) => {
        if (isScreenshotShortcut(event)) {
            reportScreenshot();
        }
    });
    window.addEventListener('keyup', (event) => {
        if (event.key === 'PrintScreen') {
            reportScreenshot();
        }
    });
}

function watchPrinting() {
    const DUPLICATE_WINDOW_MS = 2000;
    let lastReportedAt = -Infinity;
    const reportPrinting = () => {
        if (performance.now() - lastReportedAt > DUPLICATE_WINDOW_MS) {
            lastReportedAt = performance.now();
            showToast(t('Printing this?', 'Tu imprimes ça ?'));
        }
    };
    const isPrintShortcut = (event) => (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p';
    window.addEventListener('keydown', (event) => {
        if (isPrintShortcut(event)) {
            reportPrinting();
        }
    });
    window.addEventListener('beforeprint', reportPrinting);
}

function watchContextMenu() {
    const reportContextMenu = (event) => showToast(t(`You opened the context menu at ${event.clientX}, ${event.clientY}.`, `Tu as ouvert le menu contextuel en ${event.clientX}, ${event.clientY}.`));
    window.addEventListener('contextmenu', reportContextMenu);
}

function watchIdleness() {
    const IDLE_AFTER_MS = 30000;
    const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart'];
    let idleTimer = null;
    const reportIdleness = () => {
        if (document.visibilityState === 'visible') {
            showToast(t('Still there?', 'Toujours là ?'));
        }
    };
    const restartIdleTimer = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(reportIdleness, IDLE_AFTER_MS);
    };
    ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, restartIdleTimer, { passive: true }));
    restartIdleTimer();
}

function watchCopy() {
    const reportCopy = () => {
        const copiedText = window.getSelection().toString().trim();
        if (copiedText) {
            showToast(t(`You copied "${excerpt(copiedText)}".`, `Tu as copié « ${excerpt(copiedText)} ».`));
        }
    };
    document.addEventListener('copy', reportCopy);
}

function watchScrollDirection() {
    const SETTLE_DELAY_MS = 800;
    const MIN_DISTANCE_PX = 50;
    let settleTimer = null;
    let scrollStartY = null;
    const reportSettledScroll = () => {
        const scrolledDistance = Math.round(window.scrollY - scrollStartY);
        if (Math.abs(scrolledDistance) >= MIN_DISTANCE_PX) {
            showToast(t(`You scrolled ${scrolledDistance > 0 ? 'down' : 'up'} ${Math.abs(scrolledDistance)} px.`, `Tu as défilé vers le ${scrolledDistance > 0 ? 'bas' : 'haut'} de ${Math.abs(scrolledDistance)} px.`));
        }
        scrollStartY = null;
    };
    let lastKnownY = window.scrollY;
    const trackScroll = () => {
        scrollStartY ??= lastKnownY;
        lastKnownY = window.scrollY;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(reportSettledScroll, SETTLE_DELAY_MS);
    };
    window.addEventListener('scroll', trackScroll, { passive: true });
}

function watchSleep() {
    const TICK_INTERVAL_MS = 5000;
    const SLEEP_GAP_MS = 60000;
    let lastTickAt = Date.now();
    let wasVisibleAtLastTick = document.visibilityState === 'visible';
    const detectSleepGap = () => {
        const now = Date.now();
        const gap = now - lastTickAt;
        if (gap > SLEEP_GAP_MS && wasVisibleAtLastTick) {
            showToast(t(`Your computer was asleep for ${formatDuration(gap)}.`, `Ton ordinateur était en veille pendant ${formatDuration(gap)}.`));
        }
        lastTickAt = now;
        wasVisibleAtLastTick = document.visibilityState === 'visible';
    };
    setInterval(detectSleepGap, TICK_INTERVAL_MS);
}

function watchPointingDevice() {
    const CONFIRMATIONS_NEEDED = 3;
    let reportedDevice = null;
    let candidateDevice = null;
    let candidateConfirmations = 0;
    const classifyWheelEvent = (event) => {
        // Firefox reports line mode for a mouse wheel only if deltaMode is read before deltaY.
        const deltaMode = event.deltaMode;
        if (event.wheelDeltaY) {
            return event.wheelDeltaY === -3 * event.deltaY ? 'trackpad' : 'mouse';
        }
        return deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 'trackpad' : 'mouse';
    };
    const reportPointingDevice = (event) => {
        const device = classifyWheelEvent(event);
        candidateConfirmations = device === candidateDevice ? candidateConfirmations + 1 : 1;
        candidateDevice = device;
        if (candidateConfirmations >= CONFIRMATIONS_NEEDED && device !== reportedDevice) {
            reportedDevice = device;
            showToast(device === 'trackpad' ? t('You\'re using a trackpad.', 'Tu utilises un pavé tactile.') : t('You\'re using a mouse wheel.', 'Tu utilises une molette de souris.'));
        }
    };
    window.addEventListener('wheel', reportPointingDevice, { passive: true });
}

function watchCapsLock() {
    let isCapsLockOn = null;
    const reportCapsLockChange = (event) => {
        if (!event.getModifierState) {
            return;
        }
        const capsLockState = event.getModifierState('CapsLock');
        if (capsLockState === isCapsLockOn) {
            return;
        }
        if (capsLockState) {
            showToast(t('Your Caps Lock is on.', 'Ta touche Verr. Maj est activée.'));
        } else if (isCapsLockOn) {
            showToast(t('You turned Caps Lock off.', 'Tu as désactivé Verr. Maj.'));
        }
        isCapsLockOn = capsLockState;
    };
    window.addEventListener('keydown', reportCapsLockChange);
    window.addEventListener('mousedown', reportCapsLockChange);
}

function watchMiddleClick() {
    const MIDDLE_BUTTON = 1;
    const reportMiddleClick = (event) => {
        if (event.button === MIDDLE_BUTTON) {
            showToast(t('Middle click. Opening in a new tab?', 'Clic du milieu. Ouverture dans un nouvel onglet ?'));
        }
    };
    window.addEventListener('auxclick', reportMiddleClick);
}

function describeReferrerHost() {
    try {
        const referrerHost = new URL(document.referrer).hostname;
        return referrerHost && referrerHost !== window.location.hostname ? referrerHost.replace(/^www\./, '') : null;
    } catch {
        return null;
    }
}

function describeArrival() {
    const navigationType = performance.getEntriesByType('navigation')[0]?.type;
    if (navigationType === 'reload') {
        return t('You reloaded the page.', 'Tu as rechargé la page.');
    }
    if (navigationType === 'back_forward') {
        return t('You came back with the Back or Forward button.', 'Retour avec le bouton Précédent ou Suivant.');
    }
    if (navigationType === 'prerender') {
        return t('This page was loaded before you even clicked the link.', 'Cette page a été chargée avant même que tu cliques sur le lien.');
    }
    const referrerHost = describeReferrerHost();
    return referrerHost
        ? t(`You came from ${referrerHost}.`, `Tu viens de ${referrerHost}.`)
        : t('You came here directly: typed address, bookmark, or a link that hides where you came from.', 'Arrivée directe : adresse tapée, favori, ou lien qui cache ta provenance.');
}

function announceArrival() {
    const ANNOUNCE_DELAY_MS = 1500;
    setTimeout(() => showToast(describeArrival()), ANNOUNCE_DELAY_MS);
}

function setUpAttentionFeedback() {
    watchTextSelection();
    watchPaste();
    watchAbsence();
    watchCharger();
    watchMediaDevices();
    watchExitIntent();
    watchScreenshotShortcuts();
    watchPrinting();
    watchContextMenu();
    watchIdleness();
    watchCopy();
    watchScrollDirection();
    watchSleep();
    watchPointingDevice();
    watchCapsLock();
    watchMiddleClick();
    announceArrival();
}

// Expanding double ring centred on (x, y). `radiusPx` overrides the default size (set in CSS).
function showRipple(x, y, { radiusPx, extraClass } = {}) {
    const ripple = document.createElement('span');
    ripple.className = extraClass ? `click-ripple ${extraClass}` : 'click-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    if (radiusPx) {
        ripple.style.width = `${radiusPx * 2}px`;
        ripple.style.height = `${radiusPx * 2}px`;
        ripple.style.margin = `${-radiusPx}px 0 0 ${-radiusPx}px`;
    }
    const removeWhenInnerWaveEnds = (event) => {
        if (event.pseudoElement) {
            ripple.remove();
        }
    };
    ripple.addEventListener('animationend', removeWhenInnerWaveEnds);
    document.body.appendChild(ripple);
}

function setUpInteractionFeedback() {
    const describeKey = (key) => (key === ' ' ? t('Space', 'Espace') : key);
    const reportClick = (event) => {
        showRipple(event.clientX, event.clientY);
        showToast(t(`You clicked at ${event.clientX}, ${event.clientY}.`, `Tu as cliqué en ${event.clientX}, ${event.clientY}.`));
    };
    const reportKeyPress = (event) => {
        if (!event.repeat) {
            showToast(t(`You pressed ${describeKey(event.key)}.`, `Tu as appuyé sur ${describeKey(event.key)}.`));
        }
    };
    window.addEventListener('click', reportClick);
    window.addEventListener('keydown', reportKeyPress);
}

function makeEyeFollowPointer() {
    const MAX_IRIS_SHIFT_X = 12;
    const MAX_IRIS_SHIFT_Y = 7;
    const FULL_SHIFT_DISTANCE_PX = 300;
    const eye = document.getElementById('hero-eye');
    const iris = document.getElementById('hero-eye-iris');
    let pendingFrame = null;
    let pointerX = 0;
    let pointerY = 0;
    const lookAtPointer = () => {
        pendingFrame = null;
        const eyeBounds = eye.getBoundingClientRect();
        if (eyeBounds.width === 0) {
            return;
        }
        const deltaX = pointerX - (eyeBounds.left + eyeBounds.width / 2);
        const deltaY = pointerY - (eyeBounds.top + eyeBounds.height / 2);
        const angle = Math.atan2(deltaY, deltaX);
        const reach = Math.min(Math.hypot(deltaX, deltaY) / FULL_SHIFT_DISTANCE_PX, 1);
        const shiftX = Math.cos(angle) * MAX_IRIS_SHIFT_X * reach;
        const shiftY = Math.sin(angle) * MAX_IRIS_SHIFT_Y * reach;
        iris.style.transform = `translate(${shiftX.toFixed(2)}px, ${shiftY.toFixed(2)}px)`;
    };
    const scheduleLookAt = (event) => {
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (pendingFrame === null) {
            pendingFrame = requestAnimationFrame(lookAtPointer);
        }
    };
    window.addEventListener('pointermove', scheduleLookAt, { passive: true });
}

function makeEyeBlink() {
    const MIN_BLINK_INTERVAL_MS = 2500;
    const MAX_BLINK_INTERVAL_MS = 7000;
    if (matchesMedia('(prefers-reduced-motion: reduce)')) {
        return;
    }
    const eye = document.getElementById('hero-eye');
    const scheduleNextBlink = () => {
        const delay = MIN_BLINK_INTERVAL_MS + Math.random() * (MAX_BLINK_INTERVAL_MS - MIN_BLINK_INTERVAL_MS);
        setTimeout(() => eye.classList.add('is-blinking'), delay);
    };
    const endBlink = (event) => {
        if (event.animationName !== 'eye-blink') {
            return;
        }
        eye.classList.remove('is-blinking');
        scheduleNextBlink();
    };
    eye.addEventListener('animationend', endBlink);
    scheduleNextBlink();
}

function dockEyeWhenScrolled() {
    const DOCK_AFTER_SCROLL_PX = 40;
    const eye = document.getElementById('hero-eye');
    const toggleDocking = () => eye.classList.toggle('is-docked', window.scrollY > DOCK_AFTER_SCROLL_PX);
    window.addEventListener('scroll', toggleDocking, { passive: true });
    toggleDocking();
}

const SHARE_URL = 'https://nothing-to-hide.pages.dev';

// Ko-fi page URL (e.g. 'https://ko-fi.com/yourname'). The button stays hidden while it is empty.
const KOFI_URL = 'https://ko-fi.com/freesushi';

function setUpSupportActions() {
    if (KOFI_URL) {
        document.querySelectorAll('.js-kofi-link').forEach((kofiLink) => {
            kofiLink.href = KOFI_URL;
            kofiLink.hidden = false;
        });
    }
    document.getElementById('share-button').addEventListener('click', () => shareThisPage());
}

async function shareThisPage(text = t('Open this page. Don\'t click anything.', 'Ouvre cette page. Ne clique sur rien.')) {
    // The link goes inside the text: many share targets drop the text when a separate url is given.
    const message = `${text} ${SHARE_URL}`;
    const shareData = { title: document.title, text: message };
    if (navigator.share) {
        try {
            await navigator.share(shareData);
            return;
        } catch (error) {
            if (error.name === 'AbortError') {
                return;
            }
            console.error('Native share failed, falling back to clipboard', error);
        }
    }
    try {
        await navigator.clipboard.writeText(message);
        showToast(t('Message copied. Send it to someone who has "nothing to hide".', 'Message copié. Envoie-le à quelqu\'un qui n\'a « rien à cacher ».'), { evenInGameMode: true });
    } catch (error) {
        console.error('Cannot copy link', error);
        window.prompt(t('Copy this message:', 'Copie ce message :'), message);
    }
}

function setUpBackToTop() {
    const SHOW_AFTER_SCROLL_PX = 300;
    const backToTopButton = document.getElementById('back-to-top');
    const toggleVisibility = () => {
        backToTopButton.hidden = window.scrollY < SHOW_AFTER_SCROLL_PX;
    };
    const scrollToTop = () => window.scrollTo({ top: 0 });
    window.addEventListener('scroll', toggleVisibility, { passive: true });
    backToTopButton.addEventListener('click', scrollToTop);
    toggleVisibility();
}

async function main() {
    trackBehaviour();
    setUpBackToTop();
    setUpSupportActions();
    makeEyeFollowPointer();
    makeEyeBlink();
    dockEyeWhenScrolled();
    window.addEventListener('hashchange', expandBlockFromUrlHash);
    const availableSections = sections.filter((section) => isServerObservationAvailable || !section.requiresServer);
    renderSectionMenu(availableSections);
    const runs = availableSections.map((section) => {
        const { card, body } = createCard(section);
        if (section.onDemand) {
            attachOnDemandButton(section, card, body);
            return Promise.resolve(null);
        }
        if (section.live) {
            setInterval(() => renderRows(body, section.collect()), 500);
        }
        return runSection(section, body).then((rows) => (section.fingerprint ? { section, rows } : null));
    });
    const fingerprintResults = (await Promise.all(runs)).filter(Boolean);
    const components = serialiseFingerprintComponents(fingerprintResults);
    const fingerprintHash = hashFingerprintComponents(components);
    renderFingerprint(components, fingerprintHash);
    renderPortrait(fingerprintHash);
    showWelcome(fingerprintHash);
}

const highlight = (text) => ({ highlight: text });

function joinWithAnd(clauses) {
    return clauses.flatMap((clause, index) => {
        if (index === 0) {
            return clause;
        }
        return [index === clauses.length - 1 ? t(' and ', ' et ') : ', ', ...clause];
    });
}

function capitaliseSentence(segments) {
    const [first, ...rest] = segments;
    return [first.charAt(0).toUpperCase() + first.slice(1), ...rest];
}

const HIGH_REFRESH_RATE_HZ = 75;

function buildPortraitSentences(fingerprintHash) {
    const setupClauses = [
        portraitFacts.device && [t('on ', 'sur '), highlight(portraitFacts.device)],
        portraitFacts.browser && [t('browsing with ', 'avec '), highlight(portraitFacts.browser)],
        portraitFacts.internetProvider && [t('connected through ', 'via '), highlight(portraitFacts.internetProvider)],
        portraitFacts.place && [t('from around ', 'du côté de '), highlight(portraitFacts.place)],
    ].filter(Boolean);
    const localTime = new Date().toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
    const settingClauses = [
        [t('it\'s ', 'il est '), highlight(localTime), t(' where you are', ' chez toi')],
        portraitFacts.language && [t('your device speaks ', 'ton appareil parle '), highlight(portraitFacts.language)],
        portraitFacts.keyboardLayout && [t('your keyboard is ', 'ton clavier est en '), highlight(portraitFacts.keyboardLayout)],
        portraitFacts.refreshRateHz > HIGH_REFRESH_RATE_HZ && [t('your screen runs at ', 'ton écran tourne à '), highlight(`${portraitFacts.refreshRateHz} Hz`)],
    ].filter(Boolean);
    const battery = portraitFacts.battery;
    const habitClauses = [
        portraitFacts.prefersDarkMode && [t('you like ', 'tu aimes le '), highlight(t('dark mode', 'mode sombre'))],
        portraitFacts.extensions?.length && [t('you use ', 'tu utilises '), highlight(new Intl.ListFormat(LANG).format(portraitFacts.extensions))],
        portraitFacts.isLoggedInToGoogle && (LANG === 'fr'
            ? ['ta session ', highlight('Google'), ' est ouverte']
            : ['you\'re logged in to ', highlight('Google')]),
        battery && [
            t('your battery is at ', 'ta batterie est à '),
            highlight(t(`${battery.levelPercent}%`, `${battery.levelPercent} %`)),
            battery.charging ? t(' and charging', ' et en charge') : '',
        ],
    ].filter(Boolean);
    return [
        [t('Hello ', 'Salut '), highlight(fingerprintHash), '.'],
        setupClauses.length && [t('You\'re ', 'Tu es '), ...setupClauses.flatMap((clause, index) => (index === 0 ? clause : [', ', ...clause])), '.'],
        [...capitaliseSentence(joinWithAnd(settingClauses)), '.'],
        habitClauses.length && [...capitaliseSentence(joinWithAnd(habitClauses)), '.'],
        portraitFacts.isPrivateBrowsing && [t('And yes, you\'re in ', 'Et oui, tu es en '), highlight(t('incognito mode', 'navigation privée')), '.'],
    ].filter(Boolean);
}

function renderPortrait(fingerprintHash) {
    const toNode = (segment) => {
        if (typeof segment === 'string') {
            return document.createTextNode(segment);
        }
        const highlighted = document.createElement('strong');
        highlighted.textContent = segment.highlight;
        return highlighted;
    };
    const segments = buildPortraitSentences(fingerprintHash).flatMap((sentence, index) => (index === 0 ? sentence : [' ', ...sentence]));
    document.getElementById('portrait').replaceChildren(...segments.map(toNode));
}

const INCOGNITO_ICON_SVG = `
<svg viewBox="0 0 48 48" aria-hidden="true">
    <path d="M14 20 L17 9 Q18 6 21 7 L24 8 L27 7 Q30 6 31 9 L34 20 Z" fill="currentColor"/>
    <ellipse cx="24" cy="21" rx="20" ry="4" fill="currentColor"/>
    <circle cx="15" cy="33" r="6" fill="none" stroke="currentColor" stroke-width="3"/>
    <circle cx="33" cy="33" r="6" fill="none" stroke="currentColor" stroke-width="3"/>
    <path d="M21 33 Q24 30 27 33" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
</svg>`;

/* ---------- Incognito targets (shared by the ambient hunt and the game) ---------- */

const INCOGNITO_SIZE_PX = 48;
const LASER_DURATION_MS = 300;

const randomBetween = (min, max) => min + Math.random() * (max - min);

function eyeCenter() {
    const eyeBounds = document.getElementById('hero-eye').getBoundingClientRect();
    return { x: eyeBounds.left + eyeBounds.width / 2, y: eyeBounds.top + eyeBounds.height / 2 };
}

function fireLaser(point) {
    const origin = eyeCenter();
    const beam = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    beam.setAttribute('x1', origin.x);
    beam.setAttribute('y1', origin.y);
    beam.setAttribute('x2', point.x);
    beam.setAttribute('y2', point.y);
    beam.setAttribute('class', 'laser-beam');
    document.getElementById('laser-layer').appendChild(beam);
    setTimeout(() => beam.remove(), LASER_DURATION_MS);
}

function createIncognitoTarget() {
    const target = document.createElement('button');
    target.type = 'button';
    target.className = 'incognito-target';
    target.title = t('Incognito mode. Shoot it!', 'Navigation privée. Tire dessus !');
    target.setAttribute('aria-label', target.title);
    target.innerHTML = INCOGNITO_ICON_SVG;
    document.body.appendChild(target);
    return target;
}

function placeIncognitoTarget(target, x, y) {
    target.style.transform = `translate(${x}px, ${y}px)`;
}

function incognitoTargetCenter(target) {
    const bounds = target.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
}

function retireIncognitoTarget(target, endingClass) {
    target.disabled = true;
    target.classList.add(endingClass);
    target.addEventListener('animationend', () => target.remove(), { once: true });
}

function onIncognitoShot(target, shoot) {
    target.addEventListener('pointerdown', shoot);
    target.addEventListener('click', shoot);
}

/* ---------- Ambient hunt: a few targets wander while you read ---------- */

function startIncognitoHunt() {
    const FIRST_SPAWN_DELAY_MS = 2000;
    const MIN_RESPAWN_DELAY_MS = 6000;
    const MAX_RESPAWN_DELAY_MS = 15000;
    const MAX_ALIVE_TARGETS = 5;
    const MIN_SPEED_PX_PER_S = 25;
    const MAX_SPEED_PX_PER_S = 50;
    const MAX_TURN_RAD_PER_S = 1;
    const SPAWN_ZONE_WIDTH_RATIO = 0.25;
    const SPAWN_ZONE_TOP_RATIO = 0.6;
    const isMotionReduced = matchesMedia('(prefers-reduced-motion: reduce)');
    const aliveWanderers = new Set();
    let eliminatedCount = 0;
    let pendingSpawnTimer = null;
    let isPaused = false;

    const scheduleSpawn = (delay) => {
        pendingSpawnTimer = setTimeout(spawnAndScheduleNext, delay);
    };
    const scheduleNextSpawn = () => scheduleSpawn(randomBetween(MIN_RESPAWN_DELAY_MS, MAX_RESPAWN_DELAY_MS));

    function spawnAndScheduleNext() {
        pendingSpawnTimer = null;
        spawnWanderer();
        if (aliveWanderers.size < MAX_ALIVE_TARGETS) {
            scheduleNextSpawn();
        }
    }

    function resumeSpawningIfStalled() {
        if (!isPaused && pendingSpawnTimer === null) {
            scheduleNextSpawn();
        }
    }

    function pickBottomCornerSpawnPoint() {
        const maxX = window.innerWidth - INCOGNITO_SIZE_PX;
        const maxY = window.innerHeight - INCOGNITO_SIZE_PX;
        const zoneWidth = maxX * SPAWN_ZONE_WIDTH_RATIO;
        const isLeftCorner = Math.random() < 0.5;
        return {
            x: isLeftCorner ? randomBetween(0, zoneWidth) : randomBetween(maxX - zoneWidth, maxX),
            y: randomBetween(maxY * SPAWN_ZONE_TOP_RATIO, maxY),
        };
    }

    function spawnWanderer() {
        const wanderer = {
            target: createIncognitoTarget(),
            ...pickBottomCornerSpawnPoint(),
            heading: randomBetween(0, Math.PI * 2),
            speed: isMotionReduced ? 0 : randomBetween(MIN_SPEED_PX_PER_S, MAX_SPEED_PX_PER_S),
            isEnded: false,
        };
        aliveWanderers.add(wanderer);
        let lastFrameAt = null;

        const bounceOffEdges = () => {
            const boundX = window.innerWidth - INCOGNITO_SIZE_PX;
            const boundY = window.innerHeight - INCOGNITO_SIZE_PX;
            if (wanderer.x < 0 || wanderer.x > boundX) {
                wanderer.heading = Math.PI - wanderer.heading;
                wanderer.x = Math.min(Math.max(wanderer.x, 0), boundX);
            }
            if (wanderer.y < 0 || wanderer.y > boundY) {
                wanderer.heading = -wanderer.heading;
                wanderer.y = Math.min(Math.max(wanderer.y, 0), boundY);
            }
        };
        const wander = (frameAt) => {
            if (wanderer.isEnded) {
                return;
            }
            const elapsedSeconds = lastFrameAt === null ? 0 : Math.min((frameAt - lastFrameAt) / 1000, 0.1);
            lastFrameAt = frameAt;
            wanderer.heading += randomBetween(-MAX_TURN_RAD_PER_S, MAX_TURN_RAD_PER_S) * elapsedSeconds;
            wanderer.x += Math.cos(wanderer.heading) * wanderer.speed * elapsedSeconds;
            wanderer.y += Math.sin(wanderer.heading) * wanderer.speed * elapsedSeconds;
            bounceOffEdges();
            placeIncognitoTarget(wanderer.target, wanderer.x, wanderer.y);
            requestAnimationFrame(wander);
        };
        const shoot = () => {
            if (wanderer.isEnded) {
                return;
            }
            fireLaser(incognitoTargetCenter(wanderer.target));
            wanderer.isEnded = true;
            aliveWanderers.delete(wanderer);
            retireIncognitoTarget(wanderer.target, 'is-hit');
            eliminatedCount++;
            showToast(t(`Incognito mode eliminated. Score: ${eliminatedCount}`, `Navigation privée éliminée. Score : ${eliminatedCount}`));
            resumeSpawningIfStalled();
        };

        onIncognitoShot(wanderer.target, shoot);
        placeIncognitoTarget(wanderer.target, wanderer.x, wanderer.y);
        requestAnimationFrame(wander);
    }

    scheduleSpawn(FIRST_SPAWN_DELAY_MS);

    return {
        pause() {
            isPaused = true;
            clearTimeout(pendingSpawnTimer);
            pendingSpawnTimer = null;
            aliveWanderers.forEach((wanderer) => {
                wanderer.isEnded = true;
                retireIncognitoTarget(wanderer.target, 'is-leaving');
            });
            aliveWanderers.clear();
        },
        resume() {
            if (!isPaused) {
                return;
            }
            isPaused = false;
            scheduleSpawn(FIRST_SPAWN_DELAY_MS);
        },
    };
}

/* ---------- Game mode: defend the eye ---------- */

function setUpIncognitoGame(ambientHunt, fingerprintHash) {
    const LIVES = 3;
    const FIRST_SPAWN_DELAY_MS = 700;
    const START_SPAWN_INTERVAL_MS = 1600;
    const MIN_SPAWN_INTERVAL_MS = 600;
    const SPAWN_INTERVAL_DECAY_MS_PER_S = 10;
    const START_MAX_ALIVE = 3;
    const MAX_ALIVE_CAP = 10;
    const MAX_ALIVE_GROWTH_EVERY_S = 15;
    const START_SPEED_PX_PER_S = 45;
    const MAX_SPEED_PX_PER_S = 170;
    const SPEED_GROWTH_PX_PER_S2 = 1.5;
    const SPEED_SPREAD = 0.2;
    const TURN_RATE_RAD_PER_S = 2.2;
    const JITTER_RAD_PER_S = 1.5;
    const EYE_HIT_RADIUS_PX = 50;
    const CORNER_SPREAD_RATIO = 0.15;
    // Matches the .eye-shockwave animation: attackers pop as the ring sweeps over them.
    const SHOCKWAVE_DURATION_MS = 700;
    const HALF_SIZE = INCOGNITO_SIZE_PX / 2;

    const eye = document.getElementById('hero-eye');
    const hud = document.getElementById('game-hud');
    const scoreValue = document.getElementById('game-score');
    const livesElement = document.getElementById('game-lives');
    const gameOver = document.getElementById('game-over');
    const finalScore = document.getElementById('game-final-score');
    const homeButton = document.getElementById('game-home-button');
    let game = null;

    const normaliseAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    function renderHud() {
        scoreValue.textContent = game.score;
        const hearts = Array.from({ length: LIVES }, (_, index) => {
            const heart = document.createElement('span');
            heart.className = index < game.lives ? 'game-heart' : 'game-heart is-lost';
            heart.textContent = '♥';
            return heart;
        });
        livesElement.replaceChildren(...hearts);
        livesElement.setAttribute('aria-label', t(`${game.lives} lives left`, `${game.lives} vie(s) restante(s)`));
    }

    function levelAt(now) {
        const seconds = (now - game.startedAt) / 1000;
        return {
            spawnIntervalMs: Math.max(MIN_SPAWN_INTERVAL_MS, START_SPAWN_INTERVAL_MS - seconds * SPAWN_INTERVAL_DECAY_MS_PER_S),
            maxAlive: Math.min(MAX_ALIVE_CAP, START_MAX_ALIVE + Math.floor(seconds / MAX_ALIVE_GROWTH_EVERY_S)),
            speed: Math.min(MAX_SPEED_PX_PER_S, START_SPEED_PX_PER_S + seconds * SPEED_GROWTH_PX_PER_S2),
        };
    }

    // Spawn close to a screen corner (on either edge next to it): the farthest points from the centred eye.
    function pickCornerSpawnPoint() {
        const maxX = window.innerWidth - INCOGNITO_SIZE_PX;
        const maxY = window.innerHeight - INCOGNITO_SIZE_PX;
        const isLeft = Math.random() < 0.5;
        const isTop = Math.random() < 0.5;
        const offsetX = randomBetween(0, maxX * CORNER_SPREAD_RATIO);
        const offsetY = randomBetween(0, maxY * CORNER_SPREAD_RATIO);
        const isOnHorizontalEdge = Math.random() < 0.5;
        const x = isOnHorizontalEdge ? offsetX : 0;
        const y = isOnHorizontalEdge ? 0 : offsetY;
        return { x: isLeft ? x : maxX - x, y: isTop ? y : maxY - y };
    }

    function spawnAttacker(speed) {
        const { x, y } = pickCornerSpawnPoint();
        const eyePoint = eyeCenter();
        const attacker = {
            target: createIncognitoTarget(),
            x,
            y,
            heading: Math.atan2(eyePoint.y - (y + HALF_SIZE), eyePoint.x - (x + HALF_SIZE)),
            speed: speed * randomBetween(1 - SPEED_SPREAD, 1 + SPEED_SPREAD),
            isEnded: false,
        };
        attacker.target.classList.add('is-attacking');
        onIncognitoShot(attacker.target, () => shootAttacker(attacker));
        placeIncognitoTarget(attacker.target, x, y);
        game.attackers.add(attacker);
    }

    function removeAttacker(attacker, endingClass) {
        attacker.isEnded = true;
        game.attackers.delete(attacker);
        retireIncognitoTarget(attacker.target, endingClass);
    }

    function shootAttacker(attacker) {
        if (attacker.isEnded || !game || game.isOver) {
            return;
        }
        fireLaser(incognitoTargetCenter(attacker.target));
        removeAttacker(attacker, 'is-hit');
        game.score++;
        renderHud();
    }

    function hurtEye(attacker) {
        removeAttacker(attacker, 'is-impact');
        game.lives--;
        renderHud();
        eye.classList.remove('is-damaged');
        void eye.getBoundingClientRect(); // Restart the damage animation when hits come in quick succession.
        eye.classList.add('is-damaged');
        if (game.lives <= 0) {
            finishGame();
            return;
        }
        releaseShockwave();
    }

    // Breathing room after a hit: a wave from the eye wipes every attacker (no points) and the difficulty restarts.
    function releaseShockwave() {
        const eyePoint = eyeCenter();
        const radiusPx = Math.hypot(window.innerWidth, window.innerHeight);
        showRipple(eyePoint.x, eyePoint.y, { radiusPx, extraClass: 'eye-shockwave' });
        [...game.attackers].forEach((attacker) => {
            const center = incognitoTargetCenter(attacker.target);
            const distanceRatio = Math.hypot(center.x - eyePoint.x, center.y - eyePoint.y) / radiusPx;
            attacker.isEnded = true; // Frozen and harmless until the wave reaches it.
            game.attackers.delete(attacker);
            setTimeout(() => retireIncognitoTarget(attacker.target, 'is-hit'), distanceRatio * SHOCKWAVE_DURATION_MS);
        });
        const now = performance.now();
        game.startedAt = now;
        game.nextSpawnAt = now + FIRST_SPAWN_DELAY_MS + SHOCKWAVE_DURATION_MS;
    }

    function moveAttacker(attacker, eyePoint, elapsedSeconds) {
        const desiredHeading = Math.atan2(eyePoint.y - (attacker.y + HALF_SIZE), eyePoint.x - (attacker.x + HALF_SIZE));
        const maxTurn = TURN_RATE_RAD_PER_S * elapsedSeconds;
        attacker.heading += clamp(normaliseAngle(desiredHeading - attacker.heading), -maxTurn, maxTurn);
        attacker.heading += randomBetween(-JITTER_RAD_PER_S, JITTER_RAD_PER_S) * elapsedSeconds;
        attacker.x += Math.cos(attacker.heading) * attacker.speed * elapsedSeconds;
        attacker.y += Math.sin(attacker.heading) * attacker.speed * elapsedSeconds;
        placeIncognitoTarget(attacker.target, attacker.x, attacker.y);
        return Math.hypot(eyePoint.x - (attacker.x + HALF_SIZE), eyePoint.y - (attacker.y + HALF_SIZE)) < EYE_HIT_RADIUS_PX;
    }

    function tick(now) {
        if (!game || game.isOver) {
            return;
        }
        const elapsedSeconds = game.lastFrameAt === null ? 0 : Math.min((now - game.lastFrameAt) / 1000, 0.1);
        game.lastFrameAt = now;
        const level = levelAt(now);
        if (now >= game.nextSpawnAt && game.attackers.size < level.maxAlive) {
            spawnAttacker(level.speed);
            game.nextSpawnAt = now + level.spawnIntervalMs;
        }
        const eyePoint = eyeCenter();
        for (const attacker of [...game.attackers]) {
            if (attacker.isEnded) {
                continue; // Already swept away by a shockwave earlier in this frame.
            }
            if (moveAttacker(attacker, eyePoint, elapsedSeconds)) {
                hurtEye(attacker);
                if (game.isOver) {
                    return;
                }
            }
        }
        game.frame = requestAnimationFrame(tick);
    }

    function clearAttackers() {
        cancelAnimationFrame(game.frame);
        [...game.attackers].forEach((attacker) => removeAttacker(attacker, 'is-leaving'));
    }

    function startGame() {
        if (game && !game.isOver) {
            return;
        }
        ambientHunt.pause();
        document.getElementById('toasts').replaceChildren();
        document.body.classList.add('is-game-mode');
        window.scrollTo({ top: 0, behavior: 'instant' });
        const now = performance.now();
        game = {
            score: 0,
            lives: LIVES,
            startedAt: now,
            lastFrameAt: null,
            nextSpawnAt: now + FIRST_SPAWN_DELAY_MS,
            attackers: new Set(),
            frame: null,
            isOver: false,
        };
        renderHud();
        gameOver.hidden = true;
        hud.hidden = false;
        game.frame = requestAnimationFrame(tick);
    }

    function finishGame() {
        game.isOver = true;
        clearAttackers();
        finalScore.textContent = game.score;
        document.getElementById('game-over-fingerprint').textContent = fingerprintHash;
        gameOver.hidden = false;
        homeButton.focus();
    }

    function backToHome() {
        if (!game) {
            return;
        }
        if (!game.isOver) {
            game.isOver = true;
            clearAttackers();
        }
        game = null;
        gameOver.hidden = true;
        hud.hidden = true;
        eye.classList.remove('is-damaged');
        document.body.classList.remove('is-game-mode');
        window.scrollTo({ top: 0, behavior: 'instant' });
        ambientHunt.resume();
    }

    function shareScore() {
        const score = game ? game.score : 0;
        const destroyed = t(
            `I destroyed ${score} incognito mode${score === 1 ? '' : 's'}.`,
            `J'ai détruit ${score} navigation${score > 1 ? 's' : ''} privée${score > 1 ? 's' : ''}.`,
        );
        shareThisPage(`${destroyed} ${t('Your turn. Open this page. Don\'t click anything.', 'À ton tour. Ouvre cette page. Ne clique sur rien.')}`);
    }

    document.querySelector('#game-button .support-icon').innerHTML = INCOGNITO_ICON_SVG;
    document.getElementById('game-button').addEventListener('click', startGame);
    homeButton.addEventListener('click', backToHome);
    document.getElementById('game-share-button').addEventListener('click', shareScore);
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            backToHome();
        }
    });
}

function clearUrlHash() {
    if (!window.location.hash) {
        return;
    }
    try {
        history.replaceState(null, '', window.location.href.split('#')[0]);
    } catch (error) {
        // Some browsers refuse replaceState on file:// pages; an empty hash still drops the anchor.
        console.error('Cannot clear URL hash with replaceState', error);
        window.location.hash = '';
    }
}

function showWelcome(fingerprintHash) {
    const revealPage = () => {
        document.getElementById('intro').remove();
        document.getElementById('page').hidden = false;
        clearUrlHash();
        window.scrollTo({ top: 0 });
        setUpInteractionFeedback();
        setUpAttentionFeedback();
        setUpIncognitoGame(startIncognitoHunt(), fingerprintHash);
    };
    document.getElementById('intro-fingerprint').textContent = fingerprintHash;
    document.getElementById('intro-loader').remove();
    document.getElementById('intro-welcome').hidden = false;
    const revealButton = document.getElementById('intro-reveal');
    revealButton.addEventListener('click', revealPage);
    revealButton.focus();
}

main();
