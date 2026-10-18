// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons, feature names, states),
// in English and French.
// -----------------------------------------------------------------------------

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

const both = (en, fr) => ({ en, fr });

/** Two messages one after the other, in each language. */
export const join = (...messages) =>
  both(messages.map((m) => m.en).join(' '), messages.map((m) => m.fr).join(' '));

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  state: both('State', 'État'),
  water_in: both('Water in (return)', 'Eau entrante (retour)'),
  water_out: both('Water out (flow)', 'Eau sortante (départ)'),
  water_house_in: both('Heating water in', 'Eau entrante du chauffage'),
  outside: both('Outside temperature', 'Température extérieure'),
  room: both('Room temperature (thermostat)', 'Température intérieure (thermostat)'),
  dhw_top: both('Hot water tank, top', 'Ballon d’eau chaude, haut'),
  dhw_bottom: both('Hot water tank, bottom', 'Ballon d’eau chaude, bas'),
  power_in: both('Electrical power', 'Puissance électrique'),
  power_out: both('Heat output power (W)', 'Puissance thermique (W)'),
  cop: both('COP (coefficient of performance)', 'COP (coefficient de performance)'),
  flow: both('Heating water flow', 'Débit d’eau du chauffage'),
  dhw_flow: both('Hot water flow', 'Débit d’eau chaude sanitaire'),
  energy_in: both(
    'Electricity used, outdoor unit (kWh total)',
    'Électricité consommée, unité extérieure (kWh, total)',
  ),
  energy_in_indoor: both(
    'Electricity used, indoor unit (kWh total)',
    'Électricité consommée, unité intérieure (kWh, total)',
  ),
  energy_out: both('Heat produced (kWh total)', 'Chaleur produite (kWh, total)'),
};

/** The states of weheat `HeatPump.State`, and the unknown codes. */
export const STATE_NAMES = {
  offline: both('Offline', 'Hors ligne'),
  standby: both('Standby', 'En veille'),
  water_check: both('Water check', 'Contrôle de l’eau'),
  heating: both('Heating', 'Chauffage'),
  cooling: both('Cooling', 'Refroidissement'),
  dhw: both('Hot water', 'Eau chaude sanitaire'),
  legionella_prevention: both('Legionella prevention', 'Prévention de la légionelle'),
  defrosting: both('Defrosting', 'Dégivrage'),
  self_test: both('Self test', 'Autotest'),
  manual_control: both('Manual control', 'Commande manuelle'),
  updating: both('Updating', 'Mise à jour'),
  unknown: both('Unknown', 'Inconnu'),
};

/** The state as shown: its name, with the code when unknown. */
export function stateText(state, code, language) {
  const name = word(STATE_NAMES[state] ?? STATE_NAMES.unknown, language);
  return state === 'unknown' ? `${name} (${code})` : name;
}

export const T = {
  noClient: both(
    'Enter the client ID (and the client secret) Weheat gives for its API, save, then click Connect.',
    'Saisissez l’identifiant client (et le secret client) que Weheat fournit pour son API, enregistrez, puis cliquez sur Connecter.',
  ),
  signedOut: both(
    'Not signed in to Weheat: click Connect (see the steps above). The integration never signs in by itself.',
    'Non connecté à Weheat : cliquez sur Connecter (voir les étapes plus haut). L’intégration ne se connecte jamais d’elle-même.',
  ),
  expired: both(
    'The Weheat session ended (renewal refused): click Connect to sign in again. Nothing is retried by itself.',
    'La session Weheat a pris fin (renouvellement refusé) : cliquez sur Connecter pour vous reconnecter. Rien n’est réessayé de lui-même.',
  ),
  unauthorized: both(
    'Weheat refused the access of this account even with a new token: check the account, then click Connect (or "Test Weheat"). Nothing is retried by itself.',
    'Weheat a refusé l’accès de ce compte même avec un nouveau jeton : vérifiez le compte, puis cliquez sur Connecter (ou « Tester Weheat »). Rien n’est réessayé de lui-même.',
  ),
  connecting: both('Reading Weheat…', 'Lecture de Weheat…'),
  connected: (count) =>
    both(
      `Connected to Weheat: ${count} heat pump(s). Open Discovery to add them.`,
      `Connecté à Weheat : ${count} pompe(s) à chaleur. Ouvrez Découverte pour les ajouter.`,
    ),
  noPump: both(
    'Connected to Weheat, but the account has no active heat pump.',
    'Connecté à Weheat, mais le compte n’a aucune pompe à chaleur active.',
  ),
  partial: (names) =>
    both(
      `Not read this time: ${names.join(', ')} (tried again at the next refresh).`,
      `Non lue(s) cette fois : ${names.join(', ')} (nouvel essai à la prochaine relecture).`,
    ),
  rateLimited: (wait) =>
    both(
      `Weheat asks to slow down (HTTP 429): pause of ${wait.en}.`,
      `Weheat demande de ralentir (HTTP 429) : pause de ${wait.fr}.`,
    ),
  unavailable: (wait) =>
    both(
      `Weheat is unavailable (server error): next try in ${wait.en}.`,
      `Weheat est indisponible (erreur du serveur) : nouvel essai dans ${wait.fr}.`,
    ),
  unreachable: (reason, wait) =>
    both(
      `Weheat could not be read (${reason}): next try in ${wait.en}.`,
      `Weheat n’a pas pu être lu (${reason}) : nouvel essai dans ${wait.fr}.`,
    ),
  renewWaiting: (reason, wait) =>
    both(
      `The Weheat session could not be renewed (${reason}): next try in ${wait.en}.`,
      `La session Weheat n’a pas pu être renouvelée (${reason}) : nouvel essai dans ${wait.fr}.`,
    ),
  busy: both(
    'A read is already running: try again in a moment.',
    'Une lecture est déjà en cours : réessayez dans un instant.',
  ),
  test: {
    cooldown: both('Tested less than 30 seconds ago.', 'Testé il y a moins de 30 secondes.'),
  },
  signIn: {
    noRedirect: both(
      'Gladys gave no return address: write the redirect address registered with Weheat in the configuration.',
      'Gladys n’a donné aucune adresse de retour : saisissez l’adresse de redirection enregistrée chez Weheat dans la configuration.',
    ),
    noCode: both(
      'No sign-in code in the pasted text: paste the whole address the browser ended on (it holds code= and state=).',
      'Aucun code de connexion dans le texte collé : collez l’adresse complète sur laquelle le navigateur s’est arrêté (elle contient code= et state=).',
    ),
    unknown: both(
      'This address does not belong to a sign-in started in the last 15 minutes: click Connect again.',
      'Cette adresse ne correspond à aucune connexion démarrée dans les 15 dernières minutes : cliquez de nouveau sur Connecter.',
    ),
    cancelled: (detail) =>
      both(
        `Weheat did not sign you in (${detail}): click Connect again.`,
        `Weheat ne vous a pas connecté (${detail}) : cliquez de nouveau sur Connecter.`,
      ),
    refused: (detail) =>
      both(
        `Weheat refused the sign-in (${detail}): check the client ID, the client secret and the redirect address, then click Connect again.`,
        `Weheat a refusé la connexion (${detail}) : vérifiez l’identifiant client, le secret client et l’adresse de redirection, puis cliquez de nouveau sur Connecter.`,
      ),
    failed: (reason) =>
      both(
        `Weheat could not be reached (${reason}): paste the same address again in a moment.`,
        `Weheat n’a pas pu être joint (${reason}) : collez de nouveau la même adresse dans un instant.`,
      ),
    wrongAddress: both(
      'This address is not the redirect address of the sign-in: paste the address the browser ended on after the Weheat page (the sign-in stays usable).',
      'Cette adresse n’est pas l’adresse de redirection de la connexion : collez l’adresse sur laquelle le navigateur s’est arrêté après la page Weheat (la connexion reste utilisable).',
    ),
    slow: both(
      'Weheat is slow to answer: click Connect again.',
      'Weheat lent, cliquez de nouveau sur Connecter.',
    ),
    done: both(
      'Signed in to Weheat: reading the heat pumps…',
      'Connecté à Weheat : lecture des pompes à chaleur…',
    ),
  },
};
