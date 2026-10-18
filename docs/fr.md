# Weheat pour Gladys Assistant

Cette intégration lit vos pompes à chaleur **Weheat** (Blackbird, Sparrow,
Flint) par l'API officielle de Weheat, **en lecture seule** : rien n'est
jamais commandé.

> Connecteur non officiel, **sans lien avec Weheat**. **Jamais testé avec un
> vrai compte** ni une vraie pompe à chaleur pour l'instant : il suit la
> bibliothèque officielle du fabricant (`weheat`, MIT) et l'intégration Weheat
> de Home Assistant. Vos retours sont les bienvenus sur le forum Gladys.
> Weheat, Blackbird, Sparrow et Flint sont des marques de leur propriétaire.

## Ce que vous obtenez

Un appareil par pompe à chaleur active du compte, avec :

| Fonction                                                                 | Unité          | Remarque                                                   |
| ------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------- |
| État                                                                     | texte          | chauffage, eau chaude, veille, dégivrage, refroidissement… |
| Eau entrante (retour), eau sortante (départ), eau entrante du chauffage  | °C             |                                                            |
| Température extérieure                                                   | °C             | mesurée à l'entrée d'air de la pompe                       |
| Température intérieure (thermostat)                                      | °C             | seulement avec un thermostat OpenTherm                     |
| Ballon d'eau chaude, haut et bas                                         | °C             | seulement avec un ballon                                   |
| Puissance électrique                                                     | W              |                                                            |
| Puissance thermique (W)                                                  | capteur simple | négative en refroidissement ou dégivrage                   |
| COP (coefficient de performance)                                         | capteur simple | calculé sur le dernier relevé, comme Weheat                |
| Débit d'eau du chauffage, débit d'eau chaude                             | m³/h           | estimés depuis la commande des circulateurs                |
| Électricité consommée, unité extérieure et unité intérieure (kWh, total) | capteur simple | totaux depuis la mise en service                           |
| Chaleur produite (kWh, total)                                            | capteur simple | peut baisser (refroidissement, dégivrage)                  |

Les totaux d'énergie sont des **capteurs simples**, pas des index d'énergie :
Gladys ne les compte pas dans le suivi de consommation et ne leur applique
aucun tarif. La chaleur produite n'est pas de l'électricité, et le total
d'électricité est une somme calculée par le serveur de Weheat que nous
n'avons pas pu vérifier sur un vrai compte. Un index d'électricité pourra
venir quand un utilisateur aura confirmé qu'il ne fait que monter.

Le badge de chaque appareil passe à « injoignable » quand Weheat signale la
pompe hors ligne, quand elle n'a pas pu être lue, ou quand l'intégration est
arrêtée.

## Avant de commencer : l'identifiant client

L'API de Weheat demande un **identifiant client** (et un **secret client**)
fourni par Weheat, comme pour l'intégration de Home Assistant (dont la
documentation renvoie à la base de connaissances du support Weheat ; à
défaut, demandez-les au support Weheat). Weheat enregistre aussi une
**adresse de redirection** pour ce client : l'adresse vers laquelle le
navigateur revient après la connexion. Utilisez un client que Weheat vous
destine, avec ses conditions d'utilisation.

- Si Weheat a enregistré l'adresse de votre Gladys, la connexion se fait d'un
  clic.
- Sinon (par exemple un client prévu pour une autre application), la
  connexion se termine en copiant-collant une adresse (voir plus bas).

## Se connecter

1. Dans **Intégrations → Weheat → Configuration**, saisissez l'**identifiant
   client** et le **secret client**, puis enregistrez.
2. Cliquez sur **Connecter** : la page de connexion de Weheat s'ouvre.
   Connectez-vous avec l'e-mail et le mot de passe de votre compte Weheat.
   **Votre mot de passe se saisit sur la page de Weheat seulement** :
   l'intégration ne le voit jamais.
3. Weheat vous renvoie vers Gladys : l'intégration lit vos pompes à chaleur.
   Ajoutez-les depuis l'onglet **Découverte**.

### Avec une autre adresse de redirection

1. Saisissez l'adresse enregistrée par Weheat dans **Adresse de redirection**
   et enregistrez.
2. Cliquez sur **Connecter** et connectez-vous sur la page de Weheat.
3. À la fin, le navigateur s'arrête sur cette adresse (la page peut afficher
   une erreur, c'est normal). Copiez **l'adresse complète** de la barre
   d'adresse : elle contient `code=` et `state=`.
4. Collez-la dans l'action **Terminer la connexion**, dans les 15 minutes.

Une connexion démarrée ne sert qu'une fois ; après un redémarrage de
l'intégration, cliquez de nouveau sur Connecter.

## Ce que l'intégration garde

- Le **secret client** est gardé par Gladys dans sa base, comme toute valeur
  de configuration : jamais réaffiché, envoyé seulement à Weheat.
- Les **jetons** de Weheat (accès et renouvellement) sont gardés en clair
  dans le fichier `/data/weheat-state.json` du volume de l'intégration,
  lisible par son conteneur seulement (droits 0600), et envoyés seulement à
  Weheat. Le même fichier garde les pauses, les arrêts et la liste des
  pompes. Aucun mot de passe n'y est jamais écrit.

## Rythme de lecture

- Le dernier relevé de chaque pompe est relu toutes les **2 minutes** par
  défaut, et au moins 2 minutes par pompe (comme Home Assistant) :
  4 minutes avec deux pompes.
- Les totaux d'énergie sont relus toutes les 30 minutes, la liste des pompes
  toutes les 6 heures (et sur demande depuis Découverte).
- Le jeton est renouvelé par un minuteur un peu avant sa fin, jamais deux
  fois dans la même minute.

## Erreurs et arrêts

| Situation                                            | Ce que fait l'intégration                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Weheat demande de ralentir (HTTP 429)                | pause de 1 minute à 6 heures (selon Weheat), gardée après un redémarrage, pour toutes les requêtes |
| Weheat indisponible (erreur 5xx)                     | pause de 5 minutes à 1 heure, gardée après un redémarrage                                          |
| Réseau coupé, réponse inattendue                     | nouvel essai après l'intervalle, puis 5, 15, 30 minutes                                            |
| Une pompe, les totaux d'énergie ou la liste échouent | le reste continue ; nouvel essai au tour suivant (30 minutes pour l'énergie)                       |
| Renouvellement refusé par Weheat                     | arrêt « session terminée », gardé : cliquez sur Connecter                                          |
| Accès refusé même avec un nouveau jeton              | arrêt gardé : vérifiez le compte, puis Connecter ou « Tester Weheat »                              |

L'intégration ne se reconnecte jamais d'elle-même et ne réessaie jamais un
refus : seul un clic le fait. Le bouton **Tester Weheat** relit les pompes
tout de suite (une fois toutes les 30 secondes au plus).

## Dépannage

- **« Saisissez l'identifiant client »** : l'identifiant client manque.
- **Weheat refuse la connexion (`invalid_client`)** : identifiant ou secret
  client faux.
- **Weheat refuse la connexion (`invalid_grant`)** ou erreur de redirection
  sur la page de Weheat : l'adresse de redirection ne correspond pas à celle
  enregistrée pour ce client, ou l'adresse collée a plus de 15 minutes.
- **Aucune pompe** : seules les pompes à l'état « active » chez Weheat sont
  lues.

## Limites

- Lecture seule : pas de consigne, pas de mode.
- Les valeurs viennent du cloud de Weheat (dernier relevé connu), pas de la
  pompe en local.
- Jamais testé avec un vrai compte : les noms de champs et les calculs
  suivent la bibliothèque `weheat` 2026.9.3.
