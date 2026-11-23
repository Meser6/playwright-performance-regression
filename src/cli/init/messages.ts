// Texts of the init wizard in its 7 languages (04-REQ-43, D-27): questions, lessons, the summary
// and the manual instructions. Every language has the same keys and the same {placeholders}.
// Codes (INIT_*), file and option names, the written files and the other commands stay English.
// Pure.

export const LANGUAGES = ['en', 'es', 'fr', 'pl', 'it', 'uk', 'ru'] as const;
export type WizardLanguage = (typeof LANGUAGES)[number];

/** Names of the languages in themselves, shown in step 0. */
export const LANGUAGE_NAMES: Record<WizardLanguage, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  pl: 'Polski',
  it: 'Italiano',
  uk: 'Українська',
  ru: 'Русский',
};

export function isWizardLanguage(value: string): value is WizardLanguage {
  return (LANGUAGES as readonly string[]).includes(value);
}

const en = {
  declinedInstalled: '{pkg} is installed; no file was changed.',
  declinedSteps: 'To set it up by hand:',
  declinedConfig: 'Wrap the exported config in playwright.config with withPerf() from {config}.',
  declinedTest:
    'Wrap your test object with withPerfFixtures() from {fixture}, or import test from {test} instead of @playwright/test.',
  declinedDocs: 'Guide: {url}',
  declinedLater: 'Run {init} any time for the guided setup.',
  noTerminal:
    'no terminal: the default answers are used and nothing is written. Run the setup again in a terminal to write the changes.',
  dryRun: 'dry run: the planned changes are shown and nothing is written.',
  interrupted: 'interrupted.',
  answerAgain: 'Please answer again: that value is not valid here.',
  pressEnter: 'Press Enter to continue.',
  yes: 'yes',
  no: 'no',
  yesShort: 'y',
  noShort: 'n',
  stepTests: 'Which tests',
  testsLesson:
    'A measurement run takes about (tests × passes) test runs on 1 worker, so measure the tests that call the important backend endpoints.',
  taggedFiles: 'Files with tests tagged @perf: {count}.',
  noTaggedMessage: 'No test is tagged @perf yet; all tests are measured.',
  noTaggedHint:
    "To measure only some tests, tag them with test('title', { tag: '@perf' }, ...) and choose @perf.",
  scopeQuestion: 'Measure all tests or only tests tagged @perf? [{all}/@perf]',
  scopeAll: 'all',
  stepPasses: 'Passes',
  passesLesson:
    'Each rule needs a minimum number of samples per endpoint (minSamples), and samples are calls per test × tests × passes. Your test command, with its setup steps, runs once per pass.',
  passesQuestion: 'Passes of the test command in measurement runs?',
  stepMeasure: 'What to measure',
  measureApi:
    'api: response times of the backend requests your pages send and of request calls in API tests, grouped into endpoint keys such as "GET /api/users/:id".',
  measureSteps:
    'steps: durations of your test.step blocks, without changing the tests; each step becomes a key such as "checkout › pay", with its own thresholds file.',
  stepsPrivacy:
    'Step titles are sanitized: ids, e-mails, URLs and secrets never reach the keys, also inside quotes.',
  stepFilesFound: 'Files with test.step: {count}.',
  noStepsFound: 'No test.step found yet: steps are measured once you add test.step blocks.',
  measureQuestion: 'What to measure? [{all}/api/steps]',
  onlyStepsNoSteps:
    'Only steps, but no test.step was found: nothing is measured until you add test.step blocks.',
  stepCommand: 'Test command',
  commandLesson1:
    'Type the command you usually run your tests with, e.g. npm run e2e:qa. The wizard does not change anything in it: it uses it in the commands at the end and for the check.',
  commandLesson2:
    'Enter keeps the suggested command; "skip" keeps it too and skips the check at the end.',
  commandQuestion: 'Which command do you usually run your tests with?',
  commandVariable:
    'Type the command without PW_PERF_ variables: the wizard adds PW_PERF_MODE itself.',
  commandChain:
    'This command chains several commands: PW_PERF_MODE=... in front of it only reaches the first one. Put the chain in a package.json script and type npm run <script>.',
  stepChanges: 'Changes',
  nothingToChange: 'Nothing to change: the project is already set up for these answers.',
  changesLesson: 'Each change is shown as a diff before it is applied.',
  newFile: 'new file',
  modifiedFile: 'change',
  overwriteQuestion: '{path} exists. Overwrite it?',
  kept: '{path} exists and is kept.',
  applyQuestion: 'Apply this change?',
  fileWritten: 'Written: {path}',
  skipped: 'Skipped.',
  stepSummary: 'Summary',
  changedFiles: 'Changed files:',
  noFilesChanged: 'No files were changed.',
  plannedChanges: 'Planned changes (not written):',
  manualSteps: 'Manual steps: {count} (see the warnings above).',
  nextSteps: 'Next steps:',
  nextApply: 'Apply the changes above (run the setup again in a terminal).',
  originsNote:
    'Endpoint keys of the baseURL origin have no label and other hosts are labeled with their host; set shorter labels for them in keys.origins of {configFile}.',
  docs: 'Docs: {links}',
  finished: 'Setup finished.',
  noConfigMessage: 'No playwright.config.* in {dir}.',
  noConfigHint:
    'Run "{command}" in the directory of playwright.config (in a monorepo: the package with the Playwright tests).',
  tooOldMessage:
    '@playwright/test {version} is older than {min}, the lowest version {pkg} supports.',
  tooOldHint: 'Update @playwright/test to {min} or later, then run "{command}" again.',
  writeFailedMessage: 'Could not write {detail}',
  writeFailedHint: 'Check the permissions of the file and its directory, then run init again.',
  manualPerfConfigKept: '{file} exists and was not changed.',
  manualPerfConfigHint: 'Set these options in it if you want them:',
  manualConfigJson: '{config} was not changed: the package config is {file}.',
  manualConfigPattern:
    '{config} was not changed: its export is not a plain defineConfig({...}) or object (for example another wrapper).',
  configHintIntro:
    'Wrap the exported config in withPerf() as the outermost call (also around other wrappers):',
  configHintCjs: 'In {path} with module.exports: {call}.',

  declinedRun:
    'Run your test command with PW_PERF_MODE=thresholds and commit the pw-perf-thresholds*.json files, then PW_PERF_MODE=test runs the measurement (e.g. {example}).',
  about1:
    '{pkg} measures the response times of backend endpoints (and optionally your test.step blocks) in the e2e tests you already have, without changing them.',
  stepProject: 'What it does and how to run it',
  about2:
    'It derives thresholds from your own runs, fails a run on a performance regression and leaves an HTML report.',
  usageTitle: 'How to run it:',
  usageCommandPlaceholder: '<your test command>',
  usageThresholds: 'runs your tests several times on 1 worker and writes the thresholds files;',
  usageCommit: 'commit the thresholds files to the repository;',
  usageTest: 'measures again and fails on a regression; use it locally and in CI.',
  usageCommand:
    'Your test command is the one you already use (e.g. npm run e2e or npx playwright test). Every project of playwright.config it runs is measured: add --project <name> to measure one browser only.',
  variablesTitle: 'Other variables:',
  varCheck: 'a quick check of the setup on a few tests, without thresholds files',
  varMaxTests: 'tests run by a check (default 10)',
  varEnv: 'environment label: separate thresholds files for each environment',
  varPasses: 'passes of the test command in this run',
  varPrune: 'in a thresholds run: remove entries of endpoints this run did not see',
  filesTitle: 'Files:',
  fileConfig: 'settings of the package; commit it',
  fileThresholds: 'thresholds (test steps in .steps.json); commit them',
  fileReport: 'HTML report and data of the last run; do not commit (listed in .gitignore)',
  oldScripts: 'The perf:* scripts of an earlier wizard ({names}) no longer work; remove them.',
  taggedSaved: '@perf is saved as run.grep in {configFile}; your commands stay the same.',
  stepPreset: 'Threshold headroom',
  presetLesson:
    'Thresholds are the times of a thresholds run plus headroom. The preset sets the headroom of every rule:',
  presetStrict:
    'strict: small headroom; catches smaller regressions, more false alarms on a noisy environment.',
  presetNormal: 'normal: recommended to start with.',
  presetLoose: 'loose: large headroom; only clear regressions, for shared or noisy environments.',
  presetQuestion: 'How much headroom should derived thresholds have? [strict/normal/loose]',
  stepCheck: 'Check',
  checkLesson:
    'The check runs your test command like the real runs, only with 2 passes: first PW_PERF_MODE=thresholds, then PW_PERF_MODE=test. Its thresholds go to a temporary folder that is deleted afterwards; your thresholds files are not touched.',
  checkQuestion: 'Run a check now?',
  checkManual: 'Run it yourself: {command}',
  checkExit: 'The check with PW_PERF_MODE={mode} ended with exit code {code}.',
  boxTitle: 'Action needed: nothing is measured yet',
  boxWhy:
    'Without the perf fixture the package measures no request. The wizard does not change your test files; add one of these by hand:',
  boxTitleSteps: 'Action needed: endpoints are not measured yet',
  boxWhySteps:
    'Without the perf fixture the package measures no request (test.step durations are measured). The wizard does not change your test files; add one of these by hand:',
  boxFixtures: 'If you have a fixtures file that exports test:',
  boxFixturesFiles: 'Files with .extend() and the number of test files that import each:',
  boxImports:
    'If your tests import test from @playwright/test (files: {count}), change the import in each of them:',
  boxDocs: 'Other layouts (mergeTests, several test objects, playwright-bdd): {url}',
  runLine: 'Run: {command}',
  runLesson: 'A measurement is your usual test command with PW_PERF_MODE set.',
  importantTitle: 'IMPORTANT',
  importantIntro: 'What to do next, in this order:',
  importantFixFirst:
    'First add the perf fixture (red box above): until then no endpoint is measured.',
  importantThresholds:
    'Derive the thresholds on CI, on the environment where the tests will run (times from a laptop do not carry over). It can take several hours: your test command runs several times on 1 worker.',
  importantDownload:
    'Download the thresholds files from the CI artifacts: the thresholds run also copies them to the report folder {dir}. CI recipes: docs/ci.md.',
  importantCommit: 'Commit them: {files}.',
  importantTest: 'From then on run the tests with this command; it fails on a regression:',
  importantResults: 'Results: {report}; exit code details: {outcome}.',
  tryCheck:
    'Try it locally first: {command} shows what will be measured and how long a full run takes.',
  windowsNote: 'PowerShell and cmd forms of these commands: docs/cli.md.',
  boxWrapThis: 'Wrap the one your tests import: {file}',
  boxWorkspace:
    '{file} is in the workspace package {pkg}: install {self} in the workspace root (e.g. pnpm add -Dw) or in that package too.',
  manualDirectImports:
    'Test files that import test straight from @playwright/test are not measured ({count}): {files}.',
  manualDirectImportsHint: 'Change the import in each of them:',
  manualDirectImportsModuleHint:
    'Import test from {module} in them, or change the import in each of them:',
  passesSetup:
    'globalSetup and setup projects also run once per pass and their requests are not measured: make seeding idempotent.',
  commandReporter:
    'This command or its script sets --reporter: a measurement or thresholds run with it stops with RUN_REPORTER_FLAG. Use a command without --reporter for the measurement.',
  commandEveryPass:
    'The script runs this before playwright test, and it runs in every pass: {prep}. Move long preparation to its own script and give a script without it here.',
  noConfigFound:
    'playwright.config found in subfolders; run the setup in the folder of each one you want to measure:',
  checkCause: 'Most likely cause: {cause}',
  formatNote: 'Format the changed files with your formatter (e.g. prettier --write).',
  manualNewContext:
    'Requests of contexts made with request.newContext() are not measured until each context is tracked ({count}): {files}.',
  manualNewContextHint: 'Track each context right after it is created:',
};

export type MessageKey = keyof typeof en;
type Messages = Record<MessageKey, string>;

const pl: Messages = {
  declinedInstalled: '{pkg} jest zainstalowana; żaden plik nie został zmieniony.',
  declinedSteps: 'Konfiguracja ręczna:',
  declinedConfig: 'Owiń eksportowaną konfigurację w playwright.config w withPerf() z {config}.',
  declinedTest:
    'Owiń swój obiekt test w withPerfFixtures() z {fixture} albo importuj test z {test} zamiast z @playwright/test.',
  declinedDocs: 'Przewodnik: {url}',
  declinedLater: 'Konfigurację z przewodnikiem uruchomisz w każdej chwili poleceniem {init}.',
  noTerminal:
    'brak terminala: kreator przyjmuje odpowiedzi domyślne i niczego nie zapisuje. Uruchom konfigurację ponownie w terminalu, aby zapisać zmiany.',
  dryRun: 'tryb próbny: kreator pokazuje planowane zmiany i niczego nie zapisuje.',
  interrupted: 'przerwano.',
  answerAgain: 'Odpowiedz jeszcze raz: ta wartość nie jest tu poprawna.',
  pressEnter: 'Naciśnij Enter, aby kontynuować.',
  yes: 'tak',
  no: 'nie',
  yesShort: 't',
  noShort: 'n',
  stepTests: 'Które testy',
  testsLesson:
    'Pomiar trwa mniej więcej tyle, co (testy × przebiegi) uruchomień testów na 1 workerze, więc mierz testy, które wywołują ważne endpointy backendu.',
  taggedFiles: 'Pliki z testami oznaczonymi @perf: {count}.',
  noTaggedMessage: 'Żaden test nie ma jeszcze tagu @perf; mierzone są wszystkie testy.',
  noTaggedHint:
    "Aby mierzyć tylko część testów, oznacz je: test('tytuł', { tag: '@perf' }, ...) i wybierz @perf.",
  scopeQuestion: 'Mierzyć wszystkie testy czy tylko oznaczone @perf? [{all}/@perf]',
  scopeAll: 'wszystkie',
  stepPasses: 'Przebiegi',
  passesLesson:
    'Każda reguła potrzebuje minimalnej liczby próbek na endpoint (minSamples), a próbek jest: wywołania w teście × testy × przebiegi. Polecenie testów, z krokami przygotowania, wykonuje się raz na przebieg.',
  passesQuestion: 'Ile przebiegów polecenia testów w pomiarze?',
  stepMeasure: 'Co mierzyć',
  measureApi:
    'api: czasy odpowiedzi requestów backendu wysyłanych przez strony i wywołań request w testach API, pogrupowane w klucze endpointów, np. "GET /api/users/:id".',
  measureSteps:
    'steps: czasy Twoich bloków test.step, bez zmian w testach; każdy krok staje się kluczem, np. "checkout › pay", z własnym plikiem progów.',
  stepsPrivacy:
    'Tytuły kroków są czyszczone: identyfikatory, e-maile, adresy URL i sekrety nie trafiają do kluczy, także w cudzysłowach.',
  stepFilesFound: 'Pliki z test.step: {count}.',
  noStepsFound:
    'Nie znaleziono jeszcze test.step: kroki będą mierzone, gdy dodasz bloki test.step.',
  measureQuestion: 'Co mierzyć? [{all}/api/steps]',
  onlyStepsNoSteps:
    'Tylko kroki, ale nie znaleziono test.step: nic nie będzie mierzone, dopóki nie dodasz bloków test.step.',
  stepCommand: 'Polecenie testów',
  commandLesson1:
    'Wpisz polecenie, którym zwykle uruchamiasz testy, np. npm run e2e:qa. Kreator niczego w nim nie zmienia: użyje go w poleceniach na końcu i do sprawdzenia.',
  commandLesson2:
    'Enter zostawia proponowane polecenie; "skip" też je zostawia i pomija sprawdzenie na końcu.',
  commandQuestion: 'Jakim poleceniem zwykle uruchamiasz testy?',
  commandVariable: 'Wpisz polecenie bez zmiennych PW_PERF_: kreator sam dodaje PW_PERF_MODE.',
  commandChain:
    'To polecenie łączy kilka poleceń: PW_PERF_MODE=... przed nim dociera tylko do pierwszego. Zamknij łańcuch w skrypcie package.json i wpisz npm run <skrypt>.',
  stepChanges: 'Zmiany',
  nothingToChange: 'Nic do zmiany: projekt jest już skonfigurowany dla tych odpowiedzi.',
  changesLesson: 'Każda zmiana jest najpierw pokazana jako diff, a dopiero potem zastosowana.',
  newFile: 'nowy plik',
  modifiedFile: 'zmiana',
  overwriteQuestion: '{path} już istnieje. Nadpisać go?',
  kept: '{path} już istnieje i zostaje bez zmian.',
  applyQuestion: 'Zastosować tę zmianę?',
  fileWritten: 'Zapisano: {path}',
  skipped: 'Pominięto.',
  stepSummary: 'Podsumowanie',
  changedFiles: 'Zmienione pliki:',
  noFilesChanged: 'Żaden plik nie został zmieniony.',
  plannedChanges: 'Planowane zmiany (niezapisane):',
  manualSteps: 'Kroki ręczne: {count} (zobacz ostrzeżenia powyżej).',
  nextSteps: 'Następne kroki:',
  nextApply: 'Zastosuj powyższe zmiany (uruchom konfigurację ponownie w terminalu).',
  originsNote:
    'Klucze endpointów originu z baseURL nie mają etykiety, a inne hosty są oznaczone nazwą hosta; krótsze etykiety dla nich ustawisz w keys.origins w {configFile}.',
  docs: 'Dokumentacja: {links}',
  finished: 'Konfiguracja zakończona.',
  noConfigMessage: 'Brak playwright.config.* w {dir}.',
  noConfigHint:
    'Uruchom "{command}" w katalogu z playwright.config (w monorepo: w pakiecie z testami Playwrighta).',
  tooOldMessage:
    '@playwright/test {version} jest starszy niż {min}, najniższa wersja obsługiwana przez {pkg}.',
  tooOldHint:
    'Zaktualizuj @playwright/test do {min} lub nowszej, potem uruchom ponownie "{command}".',
  writeFailedMessage: 'Nie udało się zapisać {detail}',
  writeFailedHint: 'Sprawdź uprawnienia pliku i jego katalogu, potem uruchom init ponownie.',
  manualPerfConfigKept: '{file} już istnieje i nie został zmieniony.',
  manualPerfConfigHint: 'Ustaw w nim te opcje, jeśli ich potrzebujesz:',
  manualConfigJson: 'Nie zmieniono {config}: konfiguracja paczki jest w {file}.',
  manualConfigPattern:
    'Nie zmieniono {config}: eksportuje coś innego niż zwykłe defineConfig({...}) albo obiekt (np. inny wrapper).',
  configHintIntro:
    'Owiń eksportowaną konfigurację w withPerf() jako najbardziej zewnętrzne wywołanie (także wokół innych wrapperów):',
  configHintCjs: 'W {path} z module.exports: {call}.',

  declinedRun:
    'Uruchom swoje polecenie testów z PW_PERF_MODE=thresholds i zacommituj pliki pw-perf-thresholds*.json, potem PW_PERF_MODE=test wykonuje pomiar (np. {example}).',
  about1:
    '{pkg} mierzy czasy odpowiedzi endpointów backendu (i opcjonalnie bloków test.step) w Twoich istniejących testach e2e, bez zmian w testach.',
  stepProject: 'Co robi paczka i jak ją uruchamiać',
  about2:
    'Progi wyznacza sama z Twoich runów, przy regresji wydajności kończy run błędem i zostawia raport HTML.',
  usageTitle: 'Jak uruchamiać:',
  usageCommandPlaceholder: '<twoje polecenie testów>',
  usageThresholds: 'wykonuje testy kilka razy na 1 workerze i zapisuje pliki progów;',
  usageCommit: 'zacommituj pliki progów do repozytorium;',
  usageTest: 'mierzy ponownie i kończy się błędem przy regresji; używaj go lokalnie i w CI.',
  usageCommand:
    'Polecenie testów to to, którego już używasz (np. npm run e2e albo npx playwright test). Mierzony jest każdy projekt playwright.config, który ono uruchamia: dodaj --project <nazwa>, aby mierzyć tylko jedną przeglądarkę.',
  variablesTitle: 'Pozostałe zmienne:',
  varCheck: 'szybkie sprawdzenie konfiguracji na kilku testach, bez plików progów',
  varMaxTests: 'liczba testów w sprawdzeniu (domyślnie 10)',
  varEnv: 'etykieta środowiska: osobne pliki progów dla każdego środowiska',
  varPasses: 'liczba przebiegów polecenia testów w tym runie',
  varPrune: 'w runie progów: usuwa wpisy endpointów, których ten run nie widział',
  filesTitle: 'Pliki:',
  fileConfig: 'ustawienia paczki; commituj',
  fileThresholds: 'progi (kroki testów w .steps.json); commituj',
  fileReport: 'raport HTML i dane ostatniego runu; nie commituj (wpis w .gitignore)',
  oldScripts: 'Skrypty perf:* z wcześniejszej wersji kreatora ({names}) już nie działają; usuń je.',
  taggedSaved: '@perf trafia do {configFile} jako run.grep; polecenia zostają bez zmian.',
  stepPreset: 'Zapas progów',
  presetLesson: 'Progi to czasy z runu progów plus zapas. Preset ustala zapas wszystkich reguł:',
  presetStrict:
    'strict: mały zapas; łapie mniejsze regresje, częściej fałszywe alarmy na niestabilnym środowisku.',
  presetNormal: 'normal: zalecany na start.',
  presetLoose:
    'loose: duży zapas; tylko wyraźne regresje, dla współdzielonych lub zaszumionych środowisk.',
  presetQuestion: 'Jaki zapas mają mieć wyznaczone progi? [strict/normal/loose]',
  stepCheck: 'Sprawdzenie',
  checkLesson:
    'Sprawdzenie uruchamia Twoje polecenie testów jak prawdziwe runy, tylko z 2 przebiegami: najpierw PW_PERF_MODE=thresholds, potem PW_PERF_MODE=test. Jego progi trafiają do katalogu tymczasowego, usuwanego na końcu; Twoje pliki progów zostają nietknięte.',
  checkQuestion: 'Uruchomić sprawdzenie teraz?',
  checkManual: 'Uruchom je samodzielnie: {command}',
  checkExit: 'Sprawdzenie z PW_PERF_MODE={mode} zakończyło się kodem {code}.',
  boxTitle: 'Do zrobienia: na razie nic nie jest mierzone',
  boxWhy:
    "Bez fixture'u perf paczka nie mierzy żadnego requestu. Kreator nie zmienia plików testów; dodaj ręcznie jeden z wariantów:",
  boxTitleSteps: 'Do zrobienia: endpointy nie są jeszcze mierzone',
  boxWhySteps:
    "Bez fixture'u perf paczka nie mierzy żadnego requestu (czasy test.step są mierzone). Kreator nie zmienia plików testów; dodaj ręcznie jeden z wariantów:",
  boxFixtures: "Jeśli masz plik fixture'ów, który eksportuje test:",
  boxFixturesFiles: 'Pliki z .extend() i liczba plików testów, które importują każdy z nich:',
  boxImports:
    'Jeśli testy importują test z @playwright/test (plików: {count}), zmień import w każdym z nich:',
  boxDocs: 'Inne układy (mergeTests, kilka obiektów test, playwright-bdd): {url}',
  runLine: 'Uruchom: {command}',
  runLesson: 'Pomiar to Twoje zwykłe polecenie testów z ustawionym PW_PERF_MODE.',
  importantTitle: 'WAŻNE',
  importantIntro: 'Co dalej, w tej kolejności:',
  importantFixFirst:
    'Najpierw dodaj fixture perf (czerwona ramka wyżej): do tego czasu żaden endpoint nie jest mierzony.',
  importantThresholds:
    'Wyznacz progi na CI, na tym środowisku, na którym będą uruchamiane testy (czasy z laptopa się nie przenoszą). Może to potrwać kilka godzin: polecenie testów wykonuje się kilka razy na 1 workerze.',
  importantDownload:
    'Ściągnij pliki progów z artefaktów CI: run progów kopiuje je też do folderu raportu {dir}. Przykłady dla CI: docs/ci.md.',
  importantCommit: 'Zacommituj je: {files}.',
  importantTest: 'Od tej pory uruchamiaj testy tym poleceniem; kończy się błędem przy regresji:',
  importantResults: 'Wyniki: {report}; szczegóły kodu wyjścia: {outcome}.',
  tryCheck:
    'Najpierw spróbuj lokalnie: {command} pokazuje, co zostanie zmierzone i ile potrwa pełny run.',
  windowsNote: 'Wersje tych poleceń dla PowerShell i cmd: docs/cli.md.',
  boxWrapThis: 'Owiń ten, który importują Twoje testy: {file}',
  boxWorkspace:
    '{file} jest w pakiecie workspace {pkg}: zainstaluj {self} w korzeniu workspace (np. pnpm add -Dw) albo także w tym pakiecie.',
  manualDirectImports:
    'Pliki testów, które importują test prosto z @playwright/test, nie są mierzone ({count}): {files}.',
  manualDirectImportsHint: 'Zmień import w każdym z nich:',
  manualDirectImportsModuleHint:
    'Importuj w nich test z {module} albo zmień import w każdym z nich:',
  passesSetup:
    'globalSetup i projekty setup też wykonują się raz na przebieg, a ich requesty nie są mierzone: seed danych musi być idempotentny.',
  commandReporter:
    'To polecenie albo jego skrypt ustawia --reporter: run pomiarowy albo progów z nim kończy się błędem RUN_REPORTER_FLAG. Do pomiaru użyj polecenia bez --reporter.',
  commandEveryPass:
    'Skrypt uruchamia to przed playwright test, więc wykona się w każdym przebiegu: {prep}. Długie przygotowanie przenieś do osobnego skryptu, a tu podaj skrypt bez niego.',
  noConfigFound:
    'Znaleziono playwright.config w podkatalogach; uruchom konfigurację w katalogu każdego, który chcesz mierzyć:',
  checkCause: 'Najbardziej prawdopodobna przyczyna: {cause}',
  formatNote: 'Sformatuj zmienione pliki swoim formatterem (np. prettier --write).',
  manualNewContext:
    'Requesty kontekstów tworzonych przez request.newContext() nie są mierzone, dopóki każdy kontekst nie będzie śledzony ({count}): {files}.',
  manualNewContextHint: 'Śledź każdy kontekst zaraz po jego utworzeniu:',
};

const es: Messages = {
  declinedInstalled: '{pkg} está instalado; no se modificó ningún archivo.',
  declinedSteps: 'Para configurarlo a mano:',
  declinedConfig:
    'Envuelve la configuración exportada en playwright.config con withPerf() de {config}.',
  declinedTest:
    'Envuelve tu objeto test con withPerfFixtures() de {fixture}, o importa test de {test} en lugar de @playwright/test.',
  declinedDocs: 'Guía: {url}',
  declinedLater: 'Ejecuta {init} cuando quieras para la configuración guiada.',
  noTerminal:
    'sin terminal: se usan las respuestas por defecto y no se escribe nada. Ejecuta la configuración de nuevo en un terminal para escribir los cambios.',
  dryRun: 'simulación: se muestran los cambios previstos y no se escribe nada.',
  interrupted: 'interrumpido.',
  answerAgain: 'Responde de nuevo: ese valor no es válido aquí.',
  pressEnter: 'Pulsa Enter para continuar.',
  yes: 'sí',
  no: 'no',
  yesShort: 's',
  noShort: 'n',
  stepTests: 'Qué tests',
  testsLesson:
    'Una medición tarda lo que unas (tests × pasadas) ejecuciones de tests en 1 worker, así que mide los tests que llaman a los endpoints importantes del backend.',
  taggedFiles: 'Archivos con tests etiquetados @perf: {count}.',
  noTaggedMessage: 'Ningún test tiene aún la etiqueta @perf; se miden todos los tests.',
  noTaggedHint:
    "Para medir solo algunos tests, etiquétalos con test('título', { tag: '@perf' }, ...) y elige @perf.",
  scopeQuestion: '¿Medir todos los tests o solo los etiquetados @perf? [{all}/@perf]',
  scopeAll: 'todos',
  stepPasses: 'Pasadas',
  passesLesson:
    'Cada regla necesita un mínimo de muestras por endpoint (minSamples), y las muestras son llamadas por test × tests × pasadas. Tu comando de tests, con sus pasos de preparación, se ejecuta una vez por pasada.',
  passesQuestion: '¿Cuántas pasadas del comando de tests por medición?',
  stepMeasure: 'Qué medir',
  measureApi:
    'api: tiempos de respuesta de las peticiones al backend que envían tus páginas y de las llamadas request en los tests de API, agrupados en claves de endpoint como "GET /api/users/:id".',
  measureSteps:
    'steps: duración de tus bloques test.step, sin cambiar los tests; cada paso se convierte en una clave como "checkout › pay", con su propio archivo de umbrales.',
  stepsPrivacy:
    'Los títulos de los pasos se limpian: ids, correos, URL y secretos nunca llegan a las claves, tampoco entre comillas.',
  stepFilesFound: 'Archivos con test.step: {count}.',
  noStepsFound:
    'Aún no se encontró ningún test.step: los pasos se medirán cuando añadas bloques test.step.',
  measureQuestion: '¿Qué medir? [{all}/api/steps]',
  onlyStepsNoSteps:
    'Solo pasos, pero no se encontró ningún test.step: no se mide nada hasta que añadas bloques test.step.',
  stepCommand: 'Comando de tests',
  commandLesson1:
    'Escribe el comando con el que sueles ejecutar tus tests, p. ej. npm run e2e:qa. El asistente no lo modifica: lo usa en los comandos del final y para la comprobación.',
  commandLesson2:
    'Enter mantiene el comando sugerido; "skip" también lo mantiene y omite la comprobación final.',
  commandQuestion: '¿Con qué comando sueles ejecutar tus tests?',
  commandVariable:
    'Escribe el comando sin variables PW_PERF_: el asistente añade PW_PERF_MODE por sí mismo.',
  commandChain:
    'Este comando encadena varios comandos: PW_PERF_MODE=... delante solo llega al primero. Pon la cadena en un script de package.json y escribe npm run <script>.',
  stepChanges: 'Cambios',
  nothingToChange: 'Nada que cambiar: el proyecto ya está configurado para estas respuestas.',
  changesLesson: 'Cada cambio se muestra como diff antes de aplicarlo.',
  newFile: 'archivo nuevo',
  modifiedFile: 'cambio',
  overwriteQuestion: '{path} ya existe. ¿Sobrescribirlo?',
  kept: '{path} ya existe y se conserva.',
  applyQuestion: '¿Aplicar este cambio?',
  fileWritten: 'Escrito: {path}',
  skipped: 'Omitido.',
  stepSummary: 'Resumen',
  changedFiles: 'Archivos modificados:',
  noFilesChanged: 'No se modificó ningún archivo.',
  plannedChanges: 'Cambios previstos (no escritos):',
  manualSteps: 'Pasos manuales: {count} (ver las advertencias de arriba).',
  nextSteps: 'Siguientes pasos:',
  nextApply: 'Aplica los cambios de arriba (ejecuta la configuración de nuevo en un terminal).',
  originsNote:
    'Las claves de endpoint del origen de baseURL no llevan etiqueta y los demás hosts se etiquetan con su host; define etiquetas más cortas para ellos en keys.origins de {configFile}.',
  docs: 'Documentación: {links}',
  finished: 'Configuración terminada.',
  noConfigMessage: 'No hay playwright.config.* en {dir}.',
  noConfigHint:
    'Ejecuta "{command}" en el directorio de playwright.config (en un monorepo: el paquete con los tests de Playwright).',
  tooOldMessage:
    '@playwright/test {version} es anterior a {min}, la versión mínima que admite {pkg}.',
  tooOldHint: 'Actualiza @playwright/test a {min} o posterior y ejecuta "{command}" de nuevo.',
  writeFailedMessage: 'No se pudo escribir {detail}',
  writeFailedHint: 'Revisa los permisos del archivo y de su directorio y ejecuta init de nuevo.',
  manualPerfConfigKept: '{file} ya existe y no se modificó.',
  manualPerfConfigHint: 'Define en él estas opciones si las quieres:',
  manualConfigJson: '{config} no se modificó: la configuración del paquete es {file}.',
  manualConfigPattern:
    '{config} no se modificó: su export no es un defineConfig({...}) simple ni un objeto (por ejemplo, hay otro wrapper).',
  configHintIntro:
    'Envuelve la configuración exportada en withPerf() como llamada más externa (también alrededor de otros wrappers):',
  configHintCjs: 'En {path} con module.exports: {call}.',

  declinedRun:
    'Ejecuta tu comando de tests con PW_PERF_MODE=thresholds y haz commit de los archivos pw-perf-thresholds*.json; después PW_PERF_MODE=test ejecuta la medición (p. ej. {example}).',
  about1:
    '{pkg} mide los tiempos de respuesta de los endpoints del backend (y opcionalmente tus bloques test.step) en los tests e2e que ya tienes, sin cambiarlos.',
  stepProject: 'Qué hace y cómo ejecutarlo',
  about2:
    'Calcula los umbrales a partir de tus propias ejecuciones, hace fallar la ejecución ante una regresión de rendimiento y deja un informe HTML.',
  usageTitle: 'Cómo ejecutarlo:',
  usageCommandPlaceholder: '<tu comando de tests>',
  usageThresholds: 'ejecuta tus tests varias veces en 1 worker y escribe los archivos de umbrales;',
  usageCommit: 'haz commit de los archivos de umbrales en el repositorio;',
  usageTest: 'vuelve a medir y falla ante una regresión; úsalo en local y en CI.',
  usageCommand:
    'Tu comando de tests es el que ya usas (p. ej. npm run e2e o npx playwright test). Se mide cada proyecto de playwright.config que ejecuta: añade --project <nombre> para medir un solo navegador.',
  variablesTitle: 'Otras variables:',
  varCheck:
    'una comprobación rápida de la configuración con unos pocos tests, sin archivos de umbrales',
  varMaxTests: 'tests que ejecuta una comprobación (por defecto 10)',
  varEnv: 'etiqueta de entorno: archivos de umbrales separados para cada entorno',
  varPasses: 'pasadas del comando de tests en esta ejecución',
  varPrune:
    'en una ejecución de umbrales: elimina las entradas de endpoints que esta ejecución no vio',
  filesTitle: 'Archivos:',
  fileConfig: 'ajustes del paquete; haz commit',
  fileThresholds: 'umbrales (los pasos de test en .steps.json); haz commit',
  fileReport: 'informe HTML y datos de la última ejecución; no hagas commit (está en .gitignore)',
  oldScripts: 'Los scripts perf:* de un asistente anterior ({names}) ya no funcionan; elimínalos.',
  taggedSaved: '@perf se guarda como run.grep en {configFile}; tus comandos no cambian.',
  stepPreset: 'Margen de los umbrales',
  presetLesson:
    'Los umbrales son los tiempos de una ejecución de umbrales más un margen. El preset fija el margen de todas las reglas:',
  presetStrict:
    'strict: margen pequeño; detecta regresiones menores, más falsas alarmas en un entorno inestable.',
  presetNormal: 'normal: recomendado para empezar.',
  presetLoose:
    'loose: margen grande; solo regresiones claras, para entornos compartidos o ruidosos.',
  presetQuestion: '¿Cuánto margen deben tener los umbrales calculados? [strict/normal/loose]',
  stepCheck: 'Comprobación',
  checkLesson:
    'La comprobación ejecuta tu comando de tests como las ejecuciones reales, solo con 2 pasadas: primero PW_PERF_MODE=thresholds y luego PW_PERF_MODE=test. Sus umbrales van a una carpeta temporal que se borra al final; tus archivos de umbrales no se tocan.',
  checkQuestion: '¿Ejecutar la comprobación ahora?',
  checkManual: 'Ejecútala tú: {command}',
  checkExit: 'La comprobación con PW_PERF_MODE={mode} terminó con el código {code}.',
  boxTitle: 'Acción necesaria: todavía no se mide nada',
  boxWhy:
    'Sin el fixture perf el paquete no mide ninguna petición. El asistente no cambia tus archivos de tests; añade a mano una de estas opciones:',
  boxTitleSteps: 'Acción necesaria: los endpoints aún no se miden',
  boxWhySteps:
    'Sin el fixture perf el paquete no mide ninguna petición (las duraciones de test.step sí se miden). El asistente no cambia tus archivos de tests; añade a mano una de estas opciones:',
  boxFixtures: 'Si tienes un archivo de fixtures que exporta test:',
  boxFixturesFiles:
    'Archivos con .extend() y el número de archivos de tests que importan cada uno:',
  boxImports:
    'Si tus tests importan test de @playwright/test (archivos: {count}), cambia el import en cada uno:',
  boxDocs: 'Otras estructuras (mergeTests, varios objetos test, playwright-bdd): {url}',
  runLine: 'Ejecutar: {command}',
  runLesson: 'Una medición es tu comando de tests habitual con PW_PERF_MODE.',
  importantTitle: 'IMPORTANTE',
  importantIntro: 'Qué hacer ahora, en este orden:',
  importantFixFirst:
    'Primero añade el fixture perf (recuadro rojo de arriba): hasta entonces no se mide ningún endpoint.',
  importantThresholds:
    'Calcula los umbrales en CI, en el entorno donde se ejecutarán los tests (los tiempos medidos en un portátil no sirven). Puede tardar varias horas: tu comando de tests se ejecuta varias veces en 1 worker.',
  importantDownload:
    'Descarga los archivos de umbrales de los artefactos de CI: la ejecución de umbrales también los copia a la carpeta del informe {dir}. Ejemplos de CI: docs/ci.md.',
  importantCommit: 'Haz commit de ellos: {files}.',
  importantTest:
    'A partir de entonces ejecuta los tests con este comando; falla ante una regresión:',
  importantResults: 'Resultados: {report}; detalles del código de salida: {outcome}.',
  tryCheck:
    'Pruébalo antes en local: {command} muestra qué se medirá y cuánto dura una ejecución completa.',
  windowsNote: 'Formas de estos comandos para PowerShell y cmd: docs/cli.md.',
  boxWrapThis: 'Envuelve el que importan tus tests: {file}',
  boxWorkspace:
    '{file} está en el paquete del workspace {pkg}: instala {self} en la raíz del workspace (p. ej. pnpm add -Dw) o también en ese paquete.',
  manualDirectImports:
    'Los archivos de tests que importan test directamente de @playwright/test no se miden ({count}): {files}.',
  manualDirectImportsHint: 'Cambia el import en cada uno de ellos:',
  manualDirectImportsModuleHint:
    'Importa en ellos test desde {module} o cambia el import en cada uno:',
  passesSetup:
    'globalSetup y los proyectos de setup también se ejecutan una vez por pasada y sus peticiones no se miden: haz que la carga de datos sea idempotente.',
  commandReporter:
    'Este comando o su script define --reporter: una ejecución de medición o de umbrales con él se detiene con RUN_REPORTER_FLAG. Usa un comando sin --reporter para la medición.',
  commandEveryPass:
    'El script ejecuta esto antes de playwright test, así que se repite en cada pasada: {prep}. Mueve la preparación larga a su propio script e indica aquí un script sin ella.',
  noConfigFound:
    'Se encontró playwright.config en subcarpetas; ejecuta la configuración en la carpeta de cada uno que quieras medir:',
  checkCause: 'Causa más probable: {cause}',
  formatNote: 'Formatea los archivos cambiados con tu formateador (p. ej. prettier --write).',
  manualNewContext:
    'Las peticiones de contextos creados con request.newContext() no se miden hasta que cada contexto se registra ({count}): {files}.',
  manualNewContextHint: 'Registra cada contexto justo después de crearlo:',
};

const fr: Messages = {
  declinedInstalled: '{pkg} est installé ; aucun fichier n’a été modifié.',
  declinedSteps: 'Pour le configurer à la main :',
  declinedConfig:
    'Enveloppez la configuration exportée de playwright.config dans withPerf() de {config}.',
  declinedTest:
    'Enveloppez votre objet test dans withPerfFixtures() de {fixture}, ou importez test depuis {test} au lieu de @playwright/test.',
  declinedDocs: 'Guide : {url}',
  declinedLater: 'Lancez {init} à tout moment pour la configuration guidée.',
  noTerminal:
    'pas de terminal : les réponses par défaut sont utilisées et rien n’est écrit. Relancez la configuration dans un terminal pour écrire les modifications.',
  dryRun: 'simulation : les modifications prévues sont affichées et rien n’est écrit.',
  interrupted: 'interrompu.',
  answerAgain: 'Répondez à nouveau : cette valeur n’est pas valide ici.',
  pressEnter: 'Appuyez sur Entrée pour continuer.',
  yes: 'oui',
  no: 'non',
  yesShort: 'o',
  noShort: 'n',
  stepTests: 'Quels tests',
  testsLesson:
    'Une mesure dure environ autant que (tests × passes) exécutions de tests sur 1 worker : mesurez donc les tests qui appellent les endpoints importants du backend.',
  taggedFiles: 'Fichiers avec des tests marqués @perf : {count}.',
  noTaggedMessage: 'Aucun test n’est encore marqué @perf ; tous les tests sont mesurés.',
  noTaggedHint:
    "Pour ne mesurer que certains tests, marquez-les avec test('titre', { tag: '@perf' }, ...) et choisissez @perf.",
  scopeQuestion: 'Mesurer tous les tests ou seulement ceux marqués @perf ? [{all}/@perf]',
  scopeAll: 'tous',
  stepPasses: 'Passes',
  passesLesson:
    'Chaque règle demande un nombre minimal d’échantillons par endpoint (minSamples), et chaque endpoint en obtient : appels par test × tests × passes. Votre commande de tests, avec ses étapes de préparation, s’exécute une fois par passe.',
  passesQuestion: 'Combien de passes de la commande de tests par mesure ?',
  stepMeasure: 'Que mesurer',
  measureApi:
    'api : temps de réponse des requêtes backend envoyées par vos pages et des appels request dans les tests d’API, regroupés en clés d’endpoint comme "GET /api/users/:id".',
  measureSteps:
    'steps : durée de vos blocs test.step, sans modifier les tests ; chaque étape devient une clé comme "checkout › pay", avec son propre fichier de seuils.',
  stepsPrivacy:
    'Les titres des étapes sont nettoyés : identifiants, e-mails, URL et secrets n’arrivent jamais dans les clés, même entre guillemets.',
  stepFilesFound: 'Fichiers avec test.step : {count}.',
  noStepsFound:
    'Aucun test.step trouvé pour l’instant : les étapes seront mesurées dès que vous ajouterez des blocs test.step.',
  measureQuestion: 'Que mesurer ? [{all}/api/steps]',
  onlyStepsNoSteps:
    'Étapes seulement, mais aucun test.step trouvé : rien n’est mesuré tant que vous n’ajoutez pas de blocs test.step.',
  stepCommand: 'Commande de tests',
  commandLesson1:
    'Saisissez la commande avec laquelle vous lancez d’habitude vos tests, p. ex. npm run e2e:qa. L’assistant n’y change rien : il l’utilise dans les commandes à la fin et pour la vérification.',
  commandLesson2:
    'Entrée garde la commande proposée ; "skip" la garde aussi et saute la vérification finale.',
  commandQuestion: 'Avec quelle commande lancez-vous d’habitude vos tests ?',
  commandVariable:
    'Saisissez la commande sans variables PW_PERF_ : l’assistant ajoute PW_PERF_MODE lui-même.',
  commandChain:
    'Cette commande enchaîne plusieurs commandes : PW_PERF_MODE=... devant n’atteint que la première. Mettez la chaîne dans un script de package.json et saisissez npm run <script>.',
  stepChanges: 'Modifications',
  nothingToChange: 'Rien à modifier : le projet est déjà configuré pour ces réponses.',
  changesLesson: 'Chaque modification est affichée sous forme de diff avant d’être appliquée.',
  newFile: 'nouveau fichier',
  modifiedFile: 'modification',
  overwriteQuestion: '{path} existe déjà. L’écraser ?',
  kept: '{path} existe déjà et est conservé.',
  applyQuestion: 'Appliquer cette modification ?',
  fileWritten: 'Écrit : {path}',
  skipped: 'Ignoré.',
  stepSummary: 'Récapitulatif',
  changedFiles: 'Fichiers modifiés :',
  noFilesChanged: 'Aucun fichier n’a été modifié.',
  plannedChanges: 'Modifications prévues (non écrites) :',
  manualSteps: 'Étapes manuelles : {count} (voir les avertissements ci-dessus).',
  nextSteps: 'Étapes suivantes :',
  nextApply: 'Appliquez les modifications ci-dessus (relancez la configuration dans un terminal).',
  originsNote:
    'Les clés d’endpoint de l’origine du baseURL n’ont pas de libellé et les autres hôtes sont libellés avec leur hôte ; définissez des libellés plus courts dans keys.origins de {configFile}.',
  docs: 'Documentation : {links}',
  finished: 'Configuration terminée.',
  noConfigMessage: 'Aucun playwright.config.* dans {dir}.',
  noConfigHint:
    'Lancez "{command}" dans le répertoire de playwright.config (dans un monorepo : le paquet qui contient les tests Playwright).',
  tooOldMessage:
    '@playwright/test {version} est antérieur à {min}, la version minimale prise en charge par {pkg}.',
  tooOldHint: 'Mettez à jour @playwright/test en {min} ou plus, puis relancez "{command}".',
  writeFailedMessage: 'Impossible d’écrire {detail}',
  writeFailedHint: 'Vérifiez les droits du fichier et de son répertoire, puis relancez init.',
  manualPerfConfigKept: '{file} existe déjà et n’a pas été modifié.',
  manualPerfConfigHint: 'Définissez-y ces options si vous les voulez :',
  manualConfigJson: '{config} n’a pas été modifié : la configuration du paquet est {file}.',
  manualConfigPattern:
    '{config} n’a pas été modifié : son export n’est pas un simple defineConfig({...}) ni un objet (par exemple un autre wrapper).',
  configHintIntro:
    'Enveloppez la configuration exportée dans withPerf() comme appel le plus externe (aussi autour des autres wrappers) :',
  configHintCjs: 'Dans {path} avec module.exports : {call}.',

  declinedRun:
    'Lancez votre commande de tests avec PW_PERF_MODE=thresholds et commitez les fichiers pw-perf-thresholds*.json, puis PW_PERF_MODE=test lance la mesure (par ex. {example}).',
  about1:
    '{pkg} mesure les temps de réponse des endpoints du backend (et, en option, vos blocs test.step) dans les tests e2e que vous avez déjà, sans les modifier.',
  stepProject: 'Ce qu’il fait et comment le lancer',
  about2:
    'Il calcule les seuils à partir de vos propres exécutions, fait échouer l’exécution en cas de régression de performance et laisse un rapport HTML.',
  usageTitle: 'Comment le lancer :',
  usageCommandPlaceholder: '<votre commande de tests>',
  usageThresholds: 'lance vos tests plusieurs fois sur 1 worker et écrit les fichiers de seuils ;',
  usageCommit: 'commitez les fichiers de seuils dans le dépôt ;',
  usageTest: 'mesure à nouveau et échoue en cas de régression ; à utiliser en local et en CI.',
  usageCommand:
    'Votre commande de tests est celle que vous utilisez déjà (par ex. npm run e2e ou npx playwright test). Chaque projet de playwright.config qu’elle lance est mesuré : ajoutez --project <nom> pour ne mesurer qu’un navigateur.',
  variablesTitle: 'Autres variables :',
  varCheck:
    'une vérification rapide de la configuration sur quelques tests, sans fichiers de seuils',
  varMaxTests: 'tests lancés par une vérification (10 par défaut)',
  varEnv: 'étiquette d’environnement : des fichiers de seuils séparés pour chaque environnement',
  varPasses: 'passes de la commande de tests dans cette exécution',
  varPrune:
    'dans une exécution de seuils : supprime les entrées des endpoints que cette exécution n’a pas vus',
  filesTitle: 'Fichiers :',
  fileConfig: 'réglages du paquet ; à commiter',
  fileThresholds: 'seuils (étapes de test dans .steps.json) ; à commiter',
  fileReport:
    'rapport HTML et données de la dernière exécution ; à ne pas commiter (dans .gitignore)',
  oldScripts:
    'Les scripts perf:* d’un assistant précédent ({names}) ne fonctionnent plus ; supprimez-les.',
  taggedSaved:
    '@perf est enregistré comme run.grep dans {configFile} ; vos commandes restent les mêmes.',
  stepPreset: 'Marge des seuils',
  presetLesson:
    'Les seuils sont les temps d’une exécution de seuils plus une marge. Le preset fixe la marge de toutes les règles :',
  presetStrict:
    'strict : petite marge ; détecte des régressions plus faibles, plus de fausses alertes sur un environnement instable.',
  presetNormal: 'normal : recommandé pour commencer.',
  presetLoose:
    'loose : grande marge ; seulement les régressions nettes, pour des environnements partagés ou bruyants.',
  presetQuestion: 'Quelle marge pour les seuils calculés ? [strict/normal/loose]',
  stepCheck: 'Vérification',
  checkLesson:
    'La vérification lance votre commande de tests comme les vraies exécutions, mais avec 2 passes : d’abord PW_PERF_MODE=thresholds, puis PW_PERF_MODE=test. Ses seuils vont dans un dossier temporaire supprimé à la fin ; vos fichiers de seuils ne sont pas touchés.',
  checkQuestion: 'Lancer la vérification maintenant ?',
  checkManual: 'Lancez-la vous-même : {command}',
  checkExit: 'La vérification avec PW_PERF_MODE={mode} s’est terminée avec le code {code}.',
  boxTitle: 'Action requise : rien n’est encore mesuré',
  boxWhy:
    'Sans la fixture perf, le paquet ne mesure aucune requête. L’assistant ne modifie pas vos fichiers de test ; ajoutez à la main l’une de ces variantes :',
  boxTitleSteps: 'Action requise : endpoints pas encore mesurés',
  boxWhySteps:
    'Sans la fixture perf, le paquet ne mesure aucune requête (les durées des test.step sont mesurées). L’assistant ne modifie pas vos fichiers de test ; ajoutez à la main l’une de ces variantes :',
  boxFixtures: 'Si vous avez un fichier de fixtures qui exporte test :',
  boxFixturesFiles:
    'Fichiers avec .extend() et le nombre de fichiers de test qui importent chacun :',
  boxImports:
    'Si vos tests importent test depuis @playwright/test (fichiers : {count}), changez l’import dans chacun :',
  boxDocs: 'Autres structures (mergeTests, plusieurs objets test, playwright-bdd) : {url}',
  runLine: 'Lancer : {command}',
  runLesson: 'Une mesure est votre commande de tests habituelle avec PW_PERF_MODE.',
  importantTitle: 'IMPORTANT',
  importantIntro: 'Que faire ensuite, dans cet ordre :',
  importantFixFirst:
    'Ajoutez d’abord la fixture perf (cadre rouge ci-dessus) : jusque-là, aucun endpoint n’est mesuré.',
  importantThresholds:
    'Calculez les seuils en CI, sur l’environnement où les tests seront lancés (les temps mesurés sur un portable ne sont pas transposables). Cela peut prendre plusieurs heures : votre commande de tests s’exécute plusieurs fois sur 1 worker.',
  importantDownload:
    'Téléchargez les fichiers de seuils depuis les artefacts de CI : l’exécution des seuils les copie aussi dans le dossier du rapport {dir}. Exemples de CI : docs/ci.md.',
  importantCommit: 'Commitez-les : {files}.',
  importantTest:
    'Ensuite, lancez les tests avec cette commande ; elle échoue en cas de régression :',
  importantResults: 'Résultats : {report} ; détail du code de sortie : {outcome}.',
  tryCheck:
    'Essayez d’abord en local : {command} montre ce qui sera mesuré et combien de temps dure une exécution complète.',
  windowsNote: 'Formes de ces commandes pour PowerShell et cmd : docs/cli.md.',
  boxWrapThis: 'Enveloppez celui qu’importent vos tests : {file}',
  boxWorkspace:
    '{file} se trouve dans le paquet du workspace {pkg} : installez {self} à la racine du workspace (par ex. pnpm add -Dw) ou aussi dans ce paquet.',
  manualDirectImports:
    'Les fichiers de test qui importent test directement depuis @playwright/test ne sont pas mesurés ({count}) : {files}.',
  manualDirectImportsHint: 'Modifiez l’import dans chacun d’eux :',
  manualDirectImportsModuleHint:
    'Importez-y test depuis {module}, ou modifiez l’import dans chacun d’eux :',
  passesSetup:
    'globalSetup et les projets de setup s’exécutent aussi une fois par passe et leurs requêtes ne sont pas mesurées : rendez l’initialisation des données idempotente.',
  commandReporter:
    'Cette commande ou son script définit --reporter : une exécution de mesure ou de seuils s’arrête alors avec RUN_REPORTER_FLAG. Utilisez une commande sans --reporter pour la mesure.',
  commandEveryPass:
    'Le script exécute ceci avant playwright test, donc à chaque passe : {prep}. Déplacez une longue préparation dans son propre script et indiquez ici un script sans elle.',
  noConfigFound:
    'playwright.config trouvé dans des sous-dossiers ; lancez la configuration dans le dossier de chacun de ceux que vous voulez mesurer :',
  checkCause: 'Cause la plus probable : {cause}',
  formatNote: 'Formatez les fichiers modifiés avec votre formateur (par ex. prettier --write).',
  manualNewContext:
    'Les requêtes des contextes créés avec request.newContext() ne sont pas mesurées tant que chaque contexte n’est pas suivi ({count}) : {files}.',
  manualNewContextHint: 'Suivez chaque contexte juste après sa création :',
};

const it: Messages = {
  declinedInstalled: '{pkg} è installato; nessun file è stato modificato.',
  declinedSteps: 'Per configurarlo a mano:',
  declinedConfig:
    'Avvolgi la configurazione esportata in playwright.config con withPerf() da {config}.',
  declinedTest:
    'Avvolgi il tuo oggetto test con withPerfFixtures() da {fixture}, oppure importa test da {test} invece che da @playwright/test.',
  declinedDocs: 'Guida: {url}',
  declinedLater: 'Esegui {init} in qualsiasi momento per la configurazione guidata.',
  noTerminal:
    'nessun terminale: vengono usate le risposte predefinite e non viene scritto nulla. Esegui di nuovo la configurazione in un terminale per scrivere le modifiche.',
  dryRun: 'simulazione: vengono mostrate le modifiche previste e non viene scritto nulla.',
  interrupted: 'interrotto.',
  answerAgain: 'Rispondi di nuovo: quel valore non è valido qui.',
  pressEnter: 'Premi Invio per continuare.',
  yes: 'sì',
  no: 'no',
  yesShort: 's',
  noShort: 'n',
  stepTests: 'Quali test',
  testsLesson:
    'Una misurazione richiede circa (test × passate) esecuzioni di test su 1 worker, quindi misura i test che chiamano gli endpoint importanti del backend.',
  taggedFiles: 'File con test contrassegnati @perf: {count}.',
  noTaggedMessage: 'Nessun test ha ancora il tag @perf; vengono misurati tutti i test.',
  noTaggedHint:
    "Per misurare solo alcuni test, contrassegnali con test('titolo', { tag: '@perf' }, ...) e scegli @perf.",
  scopeQuestion: 'Misurare tutti i test o solo quelli contrassegnati @perf? [{all}/@perf]',
  scopeAll: 'tutti',
  stepPasses: 'Passate',
  passesLesson:
    'Ogni regola richiede un numero minimo di campioni per endpoint (minSamples), e i campioni sono chiamate per test × test × passate. Il comando di test, con i suoi passi di preparazione, viene eseguito una volta per passata.',
  passesQuestion: 'Quante passate del comando di test per misurazione?',
  stepMeasure: 'Cosa misurare',
  measureApi:
    'api: tempi di risposta delle richieste al backend inviate dalle pagine e delle chiamate request nei test API, raggruppati in chiavi di endpoint come "GET /api/users/:id".',
  measureSteps:
    'steps: durata dei blocchi test.step, senza modificare i test; ogni step diventa una chiave come "checkout › pay", con il proprio file di soglie.',
  stepsPrivacy:
    'I titoli degli step vengono ripuliti: id, e-mail, URL e segreti non finiscono mai nelle chiavi, nemmeno tra virgolette.',
  stepFilesFound: 'File con test.step: {count}.',
  noStepsFound:
    'Nessun test.step trovato per ora: gli step verranno misurati quando aggiungerai blocchi test.step.',
  measureQuestion: 'Cosa misurare? [{all}/api/steps]',
  onlyStepsNoSteps:
    'Solo step, ma nessun test.step trovato: non viene misurato nulla finché non aggiungi blocchi test.step.',
  stepCommand: 'Comando di test',
  commandLesson1:
    'Scrivi il comando con cui esegui di solito i test, ad es. npm run e2e:qa. La procedura guidata non lo modifica: lo usa nei comandi alla fine e per la verifica.',
  commandLesson2:
    'Invio mantiene il comando proposto; "skip" lo mantiene e salta la verifica finale.',
  commandQuestion: 'Con quale comando esegui di solito i test?',
  commandVariable:
    'Scrivi il comando senza variabili PW_PERF_: la procedura guidata aggiunge PW_PERF_MODE da sola.',
  commandChain:
    'Questo comando concatena più comandi: PW_PERF_MODE=... davanti raggiunge solo il primo. Metti la catena in uno script di package.json e scrivi npm run <script>.',
  stepChanges: 'Modifiche',
  nothingToChange: 'Niente da modificare: il progetto è già configurato per queste risposte.',
  changesLesson: 'Ogni modifica viene mostrata come diff prima di essere applicata.',
  newFile: 'nuovo file',
  modifiedFile: 'modifica',
  overwriteQuestion: '{path} esiste già. Sovrascriverlo?',
  kept: '{path} esiste già e viene mantenuto.',
  applyQuestion: 'Applicare questa modifica?',
  fileWritten: 'Scritto: {path}',
  skipped: 'Saltato.',
  stepSummary: 'Riepilogo',
  changedFiles: 'File modificati:',
  noFilesChanged: 'Nessun file è stato modificato.',
  plannedChanges: 'Modifiche previste (non scritte):',
  manualSteps: 'Passi manuali: {count} (vedi gli avvisi sopra).',
  nextSteps: 'Prossimi passi:',
  nextApply: 'Applica le modifiche sopra (esegui di nuovo la configurazione in un terminale).',
  originsNote:
    'Le chiavi di endpoint dell’origine di baseURL non hanno etichetta e gli altri host sono etichettati con il loro host; imposta etichette più brevi in keys.origins di {configFile}.',
  docs: 'Documentazione: {links}',
  finished: 'Configurazione completata.',
  noConfigMessage: 'Nessun playwright.config.* in {dir}.',
  noConfigHint:
    'Esegui "{command}" nella cartella di playwright.config (in un monorepo: il pacchetto con i test Playwright).',
  tooOldMessage:
    '@playwright/test {version} è precedente a {min}, la versione minima supportata da {pkg}.',
  tooOldHint: 'Aggiorna @playwright/test a {min} o successiva, poi esegui di nuovo "{command}".',
  writeFailedMessage: 'Impossibile scrivere {detail}',
  writeFailedHint: 'Controlla i permessi del file e della sua cartella, poi esegui di nuovo init.',
  manualPerfConfigKept: '{file} esiste già e non è stato modificato.',
  manualPerfConfigHint: 'Imposta lì queste opzioni, se ti servono:',
  manualConfigJson: '{config} non è stato modificato: la configurazione del pacchetto è {file}.',
  manualConfigPattern:
    '{config} non è stato modificato: il suo export non è un semplice defineConfig({...}) né un oggetto (per esempio un altro wrapper).',
  configHintIntro:
    'Avvolgi la configurazione esportata in withPerf() come chiamata più esterna (anche attorno ad altri wrapper):',
  configHintCjs: 'In {path} con module.exports: {call}.',

  declinedRun:
    'Esegui il tuo comando di test con PW_PERF_MODE=thresholds e fai commit dei file pw-perf-thresholds*.json, poi PW_PERF_MODE=test esegue la misurazione (es. {example}).',
  about1:
    '{pkg} misura i tempi di risposta degli endpoint del backend (e, se vuoi, i tuoi blocchi test.step) nei test e2e che hai già, senza modificarli.',
  stepProject: 'Cosa fa e come eseguirlo',
  about2:
    'Calcola le soglie dalle tue esecuzioni, fa fallire l’esecuzione in caso di regressione delle prestazioni e lascia un report HTML.',
  usageTitle: 'Come eseguirlo:',
  usageCommandPlaceholder: '<il tuo comando di test>',
  usageThresholds: 'esegue i test più volte su 1 worker e scrive i file delle soglie;',
  usageCommit: 'fai commit dei file delle soglie nel repository;',
  usageTest: 'misura di nuovo e fallisce in caso di regressione; usalo in locale e in CI.',
  usageCommand:
    'Il comando di test è quello che usi già (es. npm run e2e o npx playwright test). Viene misurato ogni progetto di playwright.config che esegue: aggiungi --project <nome> per misurare un solo browser.',
  variablesTitle: 'Altre variabili:',
  varCheck: 'una verifica rapida della configurazione su pochi test, senza file delle soglie',
  varMaxTests: 'test eseguiti da una verifica (predefinito 10)',
  varEnv: 'etichetta di ambiente: file delle soglie separati per ogni ambiente',
  varPasses: 'passate del comando di test in questa esecuzione',
  varPrune:
    'in un’esecuzione delle soglie: rimuove le voci degli endpoint che questa esecuzione non ha visto',
  filesTitle: 'File:',
  fileConfig: 'impostazioni del pacchetto; da committare',
  fileThresholds: 'soglie (step dei test in .steps.json); da committare',
  fileReport: 'report HTML e dati dell’ultima esecuzione; da non committare (in .gitignore)',
  oldScripts:
    'Gli script perf:* di una procedura guidata precedente ({names}) non funzionano più; rimuovili.',
  taggedSaved: '@perf viene salvato come run.grep in {configFile}; i tuoi comandi restano uguali.',
  stepPreset: 'Margine delle soglie',
  presetLesson:
    'Le soglie sono i tempi di un’esecuzione delle soglie più un margine. Il preset imposta il margine di tutte le regole:',
  presetStrict:
    'strict: margine piccolo; rileva regressioni minori, più falsi allarmi su un ambiente instabile.',
  presetNormal: 'normal: consigliato per iniziare.',
  presetLoose:
    'loose: margine ampio; solo regressioni evidenti, per ambienti condivisi o rumorosi.',
  presetQuestion: 'Quanto margine devono avere le soglie calcolate? [strict/normal/loose]',
  stepCheck: 'Verifica',
  checkLesson:
    'La verifica esegue il tuo comando di test come le esecuzioni reali, ma con 2 passate: prima PW_PERF_MODE=thresholds, poi PW_PERF_MODE=test. Le sue soglie vanno in una cartella temporanea eliminata alla fine; i tuoi file delle soglie non vengono toccati.',
  checkQuestion: 'Eseguire la verifica adesso?',
  checkManual: 'Eseguila tu: {command}',
  checkExit: 'La verifica con PW_PERF_MODE={mode} è terminata con il codice {code}.',
  boxTitle: 'Azione richiesta: per ora non si misura nulla',
  boxWhy:
    'Senza la fixture perf il pacchetto non misura alcuna richiesta. La procedura guidata non modifica i tuoi file di test; aggiungi a mano una di queste varianti:',
  boxTitleSteps: 'Azione richiesta: endpoint non ancora misurati',
  boxWhySteps:
    'Senza la fixture perf il pacchetto non misura alcuna richiesta (le durate dei test.step sono misurate). La procedura guidata non modifica i tuoi file di test; aggiungi a mano una di queste varianti:',
  boxFixtures: 'Se hai un file di fixture che esporta test:',
  boxFixturesFiles: 'File con .extend() e il numero di file di test che importano ciascuno:',
  boxImports:
    'Se i tuoi test importano test da @playwright/test (file: {count}), cambia l’import in ognuno:',
  boxDocs: 'Altre strutture (mergeTests, più oggetti test, playwright-bdd): {url}',
  runLine: 'Esegui: {command}',
  runLesson: 'Una misurazione è il tuo solito comando di test con PW_PERF_MODE.',
  importantTitle: 'IMPORTANTE',
  importantIntro: 'Cosa fare ora, in questo ordine:',
  importantFixFirst:
    'Prima aggiungi la fixture perf (riquadro rosso sopra): fino ad allora nessun endpoint viene misurato.',
  importantThresholds:
    'Calcola le soglie in CI, nell’ambiente in cui verranno eseguiti i test (i tempi misurati su un portatile non sono confrontabili). Può richiedere diverse ore: il tuo comando di test viene eseguito più volte su 1 worker.',
  importantDownload:
    'Scarica i file delle soglie dagli artefatti di CI: l’esecuzione delle soglie li copia anche nella cartella del report {dir}. Esempi di CI: docs/ci.md.',
  importantCommit: 'Committali: {files}.',
  importantTest:
    'Da quel momento esegui i test con questo comando; fallisce in caso di regressione:',
  importantResults: 'Risultati: {report}; dettagli del codice di uscita: {outcome}.',
  tryCheck:
    'Prova prima in locale: {command} mostra cosa verrà misurato e quanto dura un’esecuzione completa.',
  windowsNote: 'Forme di questi comandi per PowerShell e cmd: docs/cli.md.',
  boxWrapThis: 'Avvolgi quello che importano i tuoi test: {file}',
  boxWorkspace:
    '{file} è nel pacchetto del workspace {pkg}: installa {self} nella radice del workspace (ad es. pnpm add -Dw) o anche in quel pacchetto.',
  manualDirectImports:
    'I file di test che importano test direttamente da @playwright/test non vengono misurati ({count}): {files}.',
  manualDirectImportsHint: 'Cambia l’import in ciascuno di essi:',
  manualDirectImportsModuleHint:
    'Importa in essi test da {module}, oppure cambia l’import in ciascuno:',
  passesSetup:
    'globalSetup e i progetti di setup vengono eseguiti anch’essi una volta per passata e le loro richieste non sono misurate: rendi idempotente il seeding dei dati.',
  commandReporter:
    'Questo comando o il suo script imposta --reporter: un’esecuzione di misurazione o delle soglie si ferma con RUN_REPORTER_FLAG. Usa un comando senza --reporter per la misurazione.',
  commandEveryPass:
    'Lo script esegue questo prima di playwright test, quindi a ogni passata: {prep}. Sposta una preparazione lunga in uno script a parte e indica qui uno script senza di essa.',
  noConfigFound:
    'Trovato playwright.config in sottocartelle; esegui la configurazione nella cartella di ciascuno che vuoi misurare:',
  checkCause: 'Causa più probabile: {cause}',
  formatNote: 'Formatta i file modificati con il tuo formatter (ad es. prettier --write).',
  manualNewContext:
    'Le richieste dei contesti creati con request.newContext() non sono misurate finché ogni contesto non è tracciato ({count}): {files}.',
  manualNewContextHint: 'Traccia ogni contesto subito dopo averlo creato:',
};

const uk: Messages = {
  declinedInstalled: '{pkg} встановлено; жоден файл не змінено.',
  declinedSteps: 'Щоб налаштувати вручну:',
  declinedConfig:
    'Обгорніть експортовану конфігурацію в playwright.config у withPerf() з {config}.',
  declinedTest:
    'Обгорніть свій об’єкт test у withPerfFixtures() з {fixture} або імпортуйте test з {test} замість @playwright/test.',
  declinedDocs: 'Посібник: {url}',
  declinedLater: 'Запустіть {init} будь-коли для налаштування з підказками.',
  noTerminal:
    'немає термінала: використовуються типові відповіді, нічого не записується. Запустіть налаштування ще раз у терміналі, щоб записати зміни.',
  dryRun: 'пробний запуск: показано заплановані зміни, нічого не записується.',
  interrupted: 'перервано.',
  answerAgain: 'Відповідайте ще раз: це значення тут не підходить.',
  pressEnter: 'Натисніть Enter, щоб продовжити.',
  yes: 'так',
  no: 'ні',
  yesShort: 'т',
  noShort: 'н',
  stepTests: 'Які тести',
  testsLesson:
    'Вимірювання триває приблизно (тести × проходи) запусків тестів на 1 воркері, тож вимірюйте тести, що викликають важливі ендпоінти бекенду.',
  taggedFiles: 'Файли з тестами з тегом @perf: {count}.',
  noTaggedMessage: 'Жоден тест ще не має тегу @perf; вимірюються всі тести.',
  noTaggedHint:
    "Щоб вимірювати лише частину тестів, позначте їх: test('назва', { tag: '@perf' }, ...) і виберіть @perf.",
  scopeQuestion: 'Вимірювати всі тести чи лише з тегом @perf? [{all}/@perf]',
  scopeAll: 'усі',
  stepPasses: 'Проходи',
  passesLesson:
    'Кожне правило потребує мінімальної кількості замірів на ендпоінт (minSamples), а замірів буде: виклики в тесті × тести × проходи. Команда тестів разом із кроками підготовки виконується один раз на прохід.',
  passesQuestion: 'Скільки проходів команди тестів під час вимірювання?',
  stepMeasure: 'Що вимірювати',
  measureApi:
    'api: час відповіді запитів до бекенду, які надсилають сторінки, і викликів request в API-тестах, згрупований у ключі ендпоінтів, наприклад "GET /api/users/:id".',
  measureSteps:
    'steps: тривалість ваших блоків test.step без змін у тестах; кожен крок стає ключем, наприклад "checkout › pay", з власним файлом порогів.',
  stepsPrivacy:
    'Назви кроків очищуються: ідентифікатори, e-mail, URL і секрети ніколи не потрапляють у ключі, навіть у лапках.',
  stepFilesFound: 'Файли з test.step: {count}.',
  noStepsFound:
    'test.step поки не знайдено: кроки вимірюватимуться, щойно ви додасте блоки test.step.',
  measureQuestion: 'Що вимірювати? [{all}/api/steps]',
  onlyStepsNoSteps:
    'Лише кроки, але test.step не знайдено: нічого не вимірюється, доки ви не додасте блоки test.step.',
  stepCommand: 'Команда тестів',
  commandLesson1:
    'Введіть команду, якою ви зазвичай запускаєте тести, напр. npm run e2e:qa. Майстер нічого в ній не змінює: використає її в командах наприкінці та для перевірки.',
  commandLesson2:
    'Enter залишає запропоновану команду; "skip" теж її залишає і пропускає перевірку наприкінці.',
  commandQuestion: 'Якою командою ви зазвичай запускаєте тести?',
  commandVariable: 'Введіть команду без змінних PW_PERF_: майстер сам додає PW_PERF_MODE.',
  commandChain:
    'Ця команда поєднує кілька команд: PW_PERF_MODE=... перед нею доходить лише до першої. Помістіть ланцюжок у скрипт package.json і введіть npm run <скрипт>.',
  stepChanges: 'Зміни',
  nothingToChange: 'Нічого змінювати: проєкт уже налаштовано для цих відповідей.',
  changesLesson: 'Кожну зміну показано як diff, перш ніж її застосувати.',
  newFile: 'новий файл',
  modifiedFile: 'зміна',
  overwriteQuestion: '{path} уже існує. Перезаписати?',
  kept: '{path} уже існує і залишається без змін.',
  applyQuestion: 'Застосувати цю зміну?',
  fileWritten: 'Записано: {path}',
  skipped: 'Пропущено.',
  stepSummary: 'Підсумок',
  changedFiles: 'Змінені файли:',
  noFilesChanged: 'Жоден файл не змінено.',
  plannedChanges: 'Заплановані зміни (не записані):',
  manualSteps: 'Ручні кроки: {count} (див. попередження вище).',
  nextSteps: 'Наступні кроки:',
  nextApply: 'Застосуйте зміни вище (запустіть налаштування ще раз у терміналі).',
  originsNote:
    'Ключі ендпоінтів origin з baseURL не мають мітки, а інші хости позначаються своїм хостом; коротші мітки для них задайте в keys.origins у {configFile}.',
  docs: 'Документація: {links}',
  finished: 'Налаштування завершено.',
  noConfigMessage: 'У {dir} немає playwright.config.*.',
  noConfigHint:
    'Запустіть "{command}" у каталозі з playwright.config (у монорепозиторії: у пакеті з тестами Playwright).',
  tooOldMessage:
    '@playwright/test {version} старіший за {min}, найнижчу версію, яку підтримує {pkg}.',
  tooOldHint: 'Оновіть @playwright/test до {min} або новішої, потім знову запустіть "{command}".',
  writeFailedMessage: 'Не вдалося записати {detail}',
  writeFailedHint: 'Перевірте права доступу до файлу та його каталогу, потім знову запустіть init.',
  manualPerfConfigKept: '{file} уже існує і не змінювався.',
  manualPerfConfigHint: 'Задайте в ньому ці параметри, якщо вони потрібні:',
  manualConfigJson: '{config} не змінено: конфігурація пакета — {file}.',
  manualConfigPattern:
    '{config} не змінено: його export — не простий defineConfig({...}) і не об’єкт (наприклад, інша обгортка).',
  configHintIntro:
    'Обгорніть експортовану конфігурацію у withPerf() як найзовнішній виклик (також навколо інших обгорток):',
  configHintCjs: 'У {path} з module.exports: {call}.',

  declinedRun:
    'Запустіть свою команду тестів з PW_PERF_MODE=thresholds і закомітьте файли pw-perf-thresholds*.json, потім PW_PERF_MODE=test виконує вимірювання (напр. {example}).',
  about1:
    '{pkg} вимірює час відповіді ендпоінтів бекенду (і за бажанням ваших блоків test.step) у наявних e2e-тестах, без змін у тестах.',
  stepProject: 'Що робить пакет і як його запускати',
  about2:
    'Пакет сам обчислює пороги з ваших запусків, завершує запуск помилкою при регресії продуктивності й залишає HTML-звіт.',
  usageTitle: 'Як запускати:',
  usageCommandPlaceholder: '<ваша команда тестів>',
  usageThresholds: 'виконує тести кілька разів на 1 воркері й записує файли порогів;',
  usageCommit: 'закомітьте файли порогів у репозиторій;',
  usageTest: 'вимірює знову й завершується помилкою при регресії; локально і в CI.',
  usageCommand:
    'Команда тестів — та, якою ви вже користуєтеся (напр. npm run e2e або npx playwright test). Вимірюється кожен проєкт playwright.config, який вона запускає: додайте --project <назва>, щоб вимірювати лише один браузер.',
  variablesTitle: 'Інші змінні:',
  varCheck: 'швидка перевірка налаштування на кількох тестах, без файлів порогів',
  varMaxTests: 'кількість тестів у перевірці (типово 10)',
  varEnv: 'мітка середовища: окремі файли порогів для кожного середовища',
  varPasses: 'кількість проходів команди тестів у цьому запуску',
  varPrune: 'у запуску порогів: видаляє записи ендпоінтів, яких цей запуск не бачив',
  filesTitle: 'Файли:',
  fileConfig: 'налаштування пакета; комітьте',
  fileThresholds: 'пороги (кроки тестів у .steps.json); комітьте',
  fileReport: 'HTML-звіт і дані останнього запуску; не комітьте (є в .gitignore)',
  oldScripts:
    'Скрипти perf:* з попередньої версії майстра ({names}) більше не працюють; видаліть їх.',
  taggedSaved: '@perf зберігається як run.grep у {configFile}; ваші команди не змінюються.',
  stepPreset: 'Запас порогів',
  presetLesson:
    'Пороги — це час із запуску порогів плюс запас. Пресет задає запас для всіх правил:',
  presetStrict:
    'strict: малий запас; ловить менші регресії, частіше хибні тривоги в нестабільному середовищі.',
  presetNormal: 'normal: рекомендовано для початку.',
  presetLoose: 'loose: великий запас; лише явні регресії, для спільних або шумних середовищ.',
  presetQuestion: 'Який запас мають мати обчислені пороги? [strict/normal/loose]',
  stepCheck: 'Перевірка',
  checkLesson:
    'Перевірка запускає вашу команду тестів як справжні запуски, лише з 2 проходами: спершу PW_PERF_MODE=thresholds, потім PW_PERF_MODE=test. Її пороги потрапляють у тимчасову папку, яку потім видаляють; ваші файли порогів не змінюються.',
  checkQuestion: 'Запустити перевірку зараз?',
  checkManual: 'Запустіть її самі: {command}',
  checkExit: 'Перевірка з PW_PERF_MODE={mode} завершилася з кодом {code}.',
  boxTitle: 'Потрібна дія: поки що нічого не вимірюється',
  boxWhy:
    'Без фікстури perf пакет не вимірює жодного запиту. Майстер не змінює ваші файли тестів; додайте вручну один із варіантів:',
  boxTitleSteps: 'Потрібна дія: ендпоінти поки що не вимірюються',
  boxWhySteps:
    'Без фікстури perf пакет не вимірює жодного запиту (тривалість test.step вимірюється). Майстер не змінює ваші файли тестів; додайте вручну один із варіантів:',
  boxFixtures: 'Якщо у вас є файл фікстур, що експортує test:',
  boxFixturesFiles: 'Файли з .extend() і кількість файлів тестів, які імпортують кожен із них:',
  boxImports:
    'Якщо тести імпортують test з @playwright/test (файлів: {count}), змініть імпорт у кожному з них:',
  boxDocs: 'Інші структури (mergeTests, кілька об’єктів test, playwright-bdd): {url}',
  runLine: 'Запуск: {command}',
  runLesson: 'Вимірювання — це ваша звичайна команда тестів із PW_PERF_MODE.',
  importantTitle: 'ВАЖЛИВО',
  importantIntro: 'Що робити далі, у такому порядку:',
  importantFixFirst:
    'Спершу додайте фікстуру perf (червона рамка вище): доти жоден ендпоінт не вимірюється.',
  importantThresholds:
    'Обчисліть пороги в CI, у тому середовищі, де запускатимуться тести (час, виміряний на ноутбуці, не переноситься). Це може тривати кілька годин: ваша команда тестів виконується кілька разів на 1 воркері.',
  importantDownload:
    'Завантажте файли порогів з артефактів CI: запуск порогів також копіює їх у папку звіту {dir}. Приклади для CI: docs/ci.md.',
  importantCommit: 'Закомітьте їх: {files}.',
  importantTest:
    'Відтепер запускайте тести цією командою; вона завершується помилкою при регресії:',
  importantResults: 'Результати: {report}; подробиці коду виходу: {outcome}.',
  tryCheck:
    'Спершу спробуйте локально: {command} показує, що буде виміряно і скільки триватиме повний запуск.',
  windowsNote: 'Форми цих команд для PowerShell і cmd: docs/cli.md.',
  boxWrapThis: 'Обгорніть той, який імпортують ваші тести: {file}',
  boxWorkspace:
    '{file} у пакеті workspace {pkg}: встановіть {self} у корені workspace (напр. pnpm add -Dw) або також у цьому пакеті.',
  manualDirectImports:
    'Файли тестів, які імпортують test напряму з @playwright/test, не вимірюються ({count}): {files}.',
  manualDirectImportsHint: 'Змініть імпорт у кожному з них:',
  manualDirectImportsModuleHint:
    'Імпортуйте в них test з {module} або змініть імпорт у кожному з них:',
  passesSetup:
    'globalSetup і проєкти setup теж виконуються один раз за прохід, а їхні запити не вимірюються: зробіть заповнення даних ідемпотентним.',
  commandReporter:
    'Ця команда або її скрипт задає --reporter: вимірювальний запуск або запуск порогів із ним завершується помилкою RUN_REPORTER_FLAG. Для вимірювання використайте команду без --reporter.',
  commandEveryPass:
    'Скрипт запускає це перед playwright test, тож воно виконується в кожному проході: {prep}. Перенесіть довгу підготовку в окремий скрипт, а тут вкажіть скрипт без неї.',
  noConfigFound:
    'playwright.config знайдено в підкаталогах; запустіть налаштування в каталозі кожного, який хочете вимірювати:',
  checkCause: 'Найімовірніша причина: {cause}',
  formatNote: 'Відформатуйте змінені файли своїм форматером (напр. prettier --write).',
  manualNewContext:
    'Запити контекстів, створених через request.newContext(), не вимірюються, доки кожен контекст не відстежуватиметься ({count}): {files}.',
  manualNewContextHint: 'Відстежуйте кожен контекст одразу після створення:',
};

const ru: Messages = {
  declinedInstalled: '{pkg} установлен; ни один файл не изменён.',
  declinedSteps: 'Чтобы настроить вручную:',
  declinedConfig:
    'Оберните экспортируемую конфигурацию в playwright.config в withPerf() из {config}.',
  declinedTest:
    'Оберните свой объект test в withPerfFixtures() из {fixture} или импортируйте test из {test} вместо @playwright/test.',
  declinedDocs: 'Руководство: {url}',
  declinedLater: 'Запустите {init} в любой момент для настройки с подсказками.',
  noTerminal:
    'нет терминала: используются ответы по умолчанию, ничего не записывается. Запустите настройку ещё раз в терминале, чтобы записать изменения.',
  dryRun: 'пробный запуск: показаны запланированные изменения, ничего не записывается.',
  interrupted: 'прервано.',
  answerAgain: 'Ответьте ещё раз: это значение здесь не подходит.',
  pressEnter: 'Нажмите Enter, чтобы продолжить.',
  yes: 'да',
  no: 'нет',
  yesShort: 'д',
  noShort: 'н',
  stepTests: 'Какие тесты',
  testsLesson:
    'Измерение занимает примерно (тесты × проходы) запусков тестов на 1 воркере, поэтому измеряйте тесты, которые вызывают важные эндпоинты бэкенда.',
  taggedFiles: 'Файлы с тестами с тегом @perf: {count}.',
  noTaggedMessage: 'Ни у одного теста пока нет тега @perf; измеряются все тесты.',
  noTaggedHint:
    "Чтобы измерять только часть тестов, отметьте их: test('название', { tag: '@perf' }, ...) и выберите @perf.",
  scopeQuestion: 'Измерять все тесты или только с тегом @perf? [{all}/@perf]',
  scopeAll: 'все',
  stepPasses: 'Проходы',
  passesLesson:
    'Каждому правилу нужно минимальное число замеров на эндпоинт (minSamples), а замеров будет: вызовы в тесте × тесты × проходы. Команда тестов вместе с шагами подготовки выполняется один раз на проход.',
  passesQuestion: 'Сколько проходов команды тестов при измерении?',
  stepMeasure: 'Что измерять',
  measureApi:
    'api: время ответа запросов к бэкенду, которые отправляют страницы, и вызовов request в API-тестах, сгруппированное в ключи эндпоинтов, например "GET /api/users/:id".',
  measureSteps:
    'steps: длительность ваших блоков test.step без изменений в тестах; каждый шаг становится ключом, например "checkout › pay", с собственным файлом порогов.',
  stepsPrivacy:
    'Названия шагов очищаются: идентификаторы, e-mail, URL и секреты никогда не попадают в ключи, даже в кавычках.',
  stepFilesFound: 'Файлы с test.step: {count}.',
  noStepsFound:
    'test.step пока не найдено: шаги будут измеряться, как только вы добавите блоки test.step.',
  measureQuestion: 'Что измерять? [{all}/api/steps]',
  onlyStepsNoSteps:
    'Только шаги, но test.step не найдено: ничего не измеряется, пока вы не добавите блоки test.step.',
  stepCommand: 'Команда тестов',
  commandLesson1:
    'Введите команду, которой вы обычно запускаете тесты, напр. npm run e2e:qa. Мастер ничего в ней не меняет: использует её в командах в конце и для проверки.',
  commandLesson2:
    'Enter оставляет предложенную команду; "skip" тоже её оставляет и пропускает проверку в конце.',
  commandQuestion: 'Какой командой вы обычно запускаете тесты?',
  commandVariable: 'Введите команду без переменных PW_PERF_: мастер сам добавляет PW_PERF_MODE.',
  commandChain:
    'Эта команда объединяет несколько команд: PW_PERF_MODE=... перед ней доходит только до первой. Поместите цепочку в скрипт package.json и введите npm run <скрипт>.',
  stepChanges: 'Изменения',
  nothingToChange: 'Менять нечего: проект уже настроен для этих ответов.',
  changesLesson: 'Каждое изменение показывается как diff, прежде чем его применить.',
  newFile: 'новый файл',
  modifiedFile: 'изменение',
  overwriteQuestion: '{path} уже существует. Перезаписать?',
  kept: '{path} уже существует и остаётся без изменений.',
  applyQuestion: 'Применить это изменение?',
  fileWritten: 'Записано: {path}',
  skipped: 'Пропущено.',
  stepSummary: 'Сводка',
  changedFiles: 'Изменённые файлы:',
  noFilesChanged: 'Ни один файл не изменён.',
  plannedChanges: 'Запланированные изменения (не записаны):',
  manualSteps: 'Ручные шаги: {count} (см. предупреждения выше).',
  nextSteps: 'Дальнейшие шаги:',
  nextApply: 'Примените изменения выше (запустите настройку ещё раз в терминале).',
  originsNote:
    'Ключи эндпоинтов origin из baseURL не имеют метки, а другие хосты помечаются своим хостом; более короткие метки для них задайте в keys.origins в {configFile}.',
  docs: 'Документация: {links}',
  finished: 'Настройка завершена.',
  noConfigMessage: 'В {dir} нет playwright.config.*.',
  noConfigHint:
    'Запустите "{command}" в каталоге с playwright.config (в монорепозитории: в пакете с тестами Playwright).',
  tooOldMessage:
    '@playwright/test {version} старше {min}, минимальной версии, которую поддерживает {pkg}.',
  tooOldHint: 'Обновите @playwright/test до {min} или новее, затем снова запустите "{command}".',
  writeFailedMessage: 'Не удалось записать {detail}',
  writeFailedHint: 'Проверьте права доступа к файлу и его каталогу, затем снова запустите init.',
  manualPerfConfigKept: '{file} уже существует и не изменялся.',
  manualPerfConfigHint: 'Задайте в нём эти параметры, если они нужны:',
  manualConfigJson: '{config} не изменён: конфигурация пакета — {file}.',
  manualConfigPattern:
    '{config} не изменён: его export — не простой defineConfig({...}) и не объект (например, другая обёртка).',
  configHintIntro:
    'Оберните экспортируемую конфигурацию в withPerf() как самый внешний вызов (в том числе вокруг других обёрток):',
  configHintCjs: 'В {path} с module.exports: {call}.',

  declinedRun:
    'Запустите свою команду тестов с PW_PERF_MODE=thresholds и закоммитьте файлы pw-perf-thresholds*.json, затем PW_PERF_MODE=test выполняет измерение (напр. {example}).',
  about1:
    '{pkg} измеряет время ответа эндпоинтов бэкенда (и по желанию ваших блоков test.step) в уже существующих e2e-тестах, без изменений в тестах.',
  stepProject: 'Что делает пакет и как его запускать',
  about2:
    'Пакет сам вычисляет пороги по вашим запускам, завершает запуск с ошибкой при регрессии производительности и оставляет HTML-отчёт.',
  usageTitle: 'Как запускать:',
  usageCommandPlaceholder: '<ваша команда тестов>',
  usageThresholds: 'выполняет тесты несколько раз на 1 воркере и записывает файлы порогов;',
  usageCommit: 'закоммитьте файлы порогов в репозиторий;',
  usageTest: 'измеряет снова и завершается с ошибкой при регрессии; локально и в CI.',
  usageCommand:
    'Команда тестов — та, которой вы уже пользуетесь (напр. npm run e2e или npx playwright test). Измеряется каждый проект playwright.config, который она запускает: добавьте --project <имя>, чтобы измерять только один браузер.',
  variablesTitle: 'Другие переменные:',
  varCheck: 'быстрая проверка настройки на нескольких тестах, без файлов порогов',
  varMaxTests: 'число тестов в проверке (по умолчанию 10)',
  varEnv: 'метка окружения: отдельные файлы порогов для каждого окружения',
  varPasses: 'число проходов команды тестов в этом запуске',
  varPrune: 'в запуске порогов: удаляет записи эндпоинтов, которых этот запуск не видел',
  filesTitle: 'Файлы:',
  fileConfig: 'настройки пакета; коммитьте',
  fileThresholds: 'пороги (шаги тестов в .steps.json); коммитьте',
  fileReport: 'HTML-отчёт и данные последнего запуска; не коммитьте (есть в .gitignore)',
  oldScripts: 'Скрипты perf:* из прежней версии мастера ({names}) больше не работают; удалите их.',
  taggedSaved: '@perf сохраняется как run.grep в {configFile}; ваши команды не меняются.',
  stepPreset: 'Запас порогов',
  presetLesson:
    'Пороги — это время из запуска порогов плюс запас. Пресет задаёт запас для всех правил:',
  presetStrict:
    'strict: малый запас; ловит меньшие регрессии, чаще ложные тревоги в нестабильном окружении.',
  presetNormal: 'normal: рекомендуется для начала.',
  presetLoose: 'loose: большой запас; только явные регрессии, для общих или шумных окружений.',
  presetQuestion: 'Какой запас должен быть у вычисленных порогов? [strict/normal/loose]',
  stepCheck: 'Проверка',
  checkLesson:
    'Проверка запускает вашу команду тестов как настоящие запуски, только с 2 проходами: сначала PW_PERF_MODE=thresholds, затем PW_PERF_MODE=test. Её пороги попадают во временную папку, которая затем удаляется; ваши файлы порогов не меняются.',
  checkQuestion: 'Запустить проверку сейчас?',
  checkManual: 'Запустите её сами: {command}',
  checkExit: 'Проверка с PW_PERF_MODE={mode} завершилась с кодом {code}.',
  boxTitle: 'Требуется действие: пока ничего не измеряется',
  boxWhy:
    'Без фикстуры perf пакет не измеряет ни одного запроса. Мастер не меняет ваши файлы тестов; добавьте вручную один из вариантов:',
  boxTitleSteps: 'Требуется действие: эндпоинты пока не измеряются',
  boxWhySteps:
    'Без фикстуры perf пакет не измеряет ни одного запроса (длительность test.step измеряется). Мастер не меняет ваши файлы тестов; добавьте вручную один из вариантов:',
  boxFixtures: 'Если у вас есть файл фикстур, который экспортирует test:',
  boxFixturesFiles: 'Файлы с .extend() и число файлов тестов, которые импортируют каждый из них:',
  boxImports:
    'Если тесты импортируют test из @playwright/test (файлов: {count}), измените импорт в каждом из них:',
  boxDocs: 'Другие структуры (mergeTests, несколько объектов test, playwright-bdd): {url}',
  runLine: 'Запуск: {command}',
  runLesson: 'Измерение — это ваша обычная команда тестов с PW_PERF_MODE.',
  importantTitle: 'ВАЖНО',
  importantIntro: 'Что делать дальше, в таком порядке:',
  importantFixFirst:
    'Сначала добавьте фикстуру perf (красная рамка выше): до этого ни один эндпоинт не измеряется.',
  importantThresholds:
    'Вычислите пороги в CI, в том окружении, где будут запускаться тесты (время, измеренное на ноутбуке, не переносится). Это может занять несколько часов: ваша команда тестов выполняется несколько раз на 1 воркере.',
  importantDownload:
    'Скачайте файлы порогов из артефактов CI: запуск порогов также копирует их в папку отчёта {dir}. Примеры для CI: docs/ci.md.',
  importantCommit: 'Закоммитьте их: {files}.',
  importantTest:
    'С этого момента запускайте тесты этой командой; она завершается с ошибкой при регрессии:',
  importantResults: 'Результаты: {report}; подробности кода выхода: {outcome}.',
  tryCheck:
    'Сначала попробуйте локально: {command} показывает, что будет измерено и сколько займёт полный запуск.',
  windowsNote: 'Формы этих команд для PowerShell и cmd: docs/cli.md.',
  boxWrapThis: 'Оберните тот, который импортируют ваши тесты: {file}',
  boxWorkspace:
    '{file} находится в пакете workspace {pkg}: установите {self} в корне workspace (напр. pnpm add -Dw) или также в этом пакете.',
  manualDirectImports:
    'Файлы тестов, которые импортируют test напрямую из @playwright/test, не измеряются ({count}): {files}.',
  manualDirectImportsHint: 'Измените импорт в каждом из них:',
  manualDirectImportsModuleHint:
    'Импортируйте в них test из {module} или измените импорт в каждом из них:',
  passesSetup:
    'globalSetup и проекты setup тоже выполняются один раз за проход, а их запросы не измеряются: сделайте заполнение данных идемпотентным.',
  commandReporter:
    'Эта команда или её скрипт задаёт --reporter: измерительный запуск или запуск порогов с ним завершается с ошибкой RUN_REPORTER_FLAG. Для измерения используйте команду без --reporter.',
  commandEveryPass:
    'Скрипт запускает это перед playwright test, поэтому оно выполняется в каждом проходе: {prep}. Перенесите долгую подготовку в отдельный скрипт, а здесь укажите скрипт без неё.',
  noConfigFound:
    'playwright.config найден в подкаталогах; запустите настройку в каталоге каждого, который хотите измерять:',
  checkCause: 'Наиболее вероятная причина: {cause}',
  formatNote: 'Отформатируйте изменённые файлы своим форматтером (напр. prettier --write).',
  manualNewContext:
    'Запросы контекстов, созданных через request.newContext(), не измеряются, пока каждый контекст не начнёт отслеживаться ({count}): {files}.',
  manualNewContextHint: 'Отслеживайте каждый контекст сразу после создания:',
};

export const MESSAGES: Record<WizardLanguage, Messages> = { en, es, fr, pl, it, uk, ru };

const PLACEHOLDER = /\{(\w+)\}/gu;

/** The {name} placeholders of a text, sorted and without duplicates. */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as string))].sort();
}

export type MessageValues = Readonly<Record<string, string | number>>;

/** Fills the {name} placeholders; other braces (such as `{...}` in code) stay. */
export function format(text: string, values: MessageValues = {}): string {
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    values[name] === undefined ? whole : String(values[name]),
  );
}

/** Text of `key` in one language. */
export type Translate = (key: MessageKey, values?: MessageValues) => string;

export function translator(lang: WizardLanguage): Translate {
  return (key, values) => format(MESSAGES[lang][key], values);
}
