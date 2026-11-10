// Canadian French (chunk 7U): only the messages whose wording differs from France French
// ("courriel" for e-mail, "soumission" for a quote, "téléverser" for upload); every other key
// falls back to fr.ts. Machine-assisted: native-speaker review is required before it ships.
import type { Catalog } from "../core";

export const frCA: Partial<Catalog> = {
  "cross.help": "D'après les factures des 12 derniers mois sur cet appareil : articles achetés ensemble au moins 3 fois, avec un lift de 1,2 ou plus. Les articles déjà dans cette soumission, ou achetés par ce client pendant cette période, sont exclus.",
  "cross.addFor": "Ajouter {sku} à la soumission",
  "app.description": "Tarification sécurisée, garde-fous pour les soumissions et suivi des ristournes pour les distributeurs.",
  "relay.thisSharesASummary": "Ceci partage un résumé, pas votre coffre-fort ni votre historique de factures. Le destinataire doit vérifier la soumission ou le changement référencé avant d'approuver.",
  "relay.quoteReference": "Référence de soumission",
  "frame.quoting": "Soumissions",
  "page.login.useAVerifiedEmail": "Utilisez une adresse courriel vérifiée. Seuls les utilisateurs invités peuvent rejoindre l'espace de travail d'une entreprise existante.",
  "page.setup.youAreNotA": "Vous n'êtes membre d'aucun espace de travail existant. Créez un espace de travail pour votre entreprise, ou connectez-vous avec l'adresse courriel qui a reçu votre invitation.",
  "page.invite.signInUsingThe": "Connectez-vous avec l'adresse courriel invitée par le propriétaire de l'espace de travail. Le lien est à usage unique et expire après sept jours.",
  "page.users.email": "Courriel",
  "invite.emailAddress": "Adresse courriel",
  "login.checkYourEmailFor": "Consultez vos courriels : un lien de connexion sécurisé vous a été envoyé. Si vous avez été invité, le lien finalisera votre arrivée dans cet espace de travail.",
  "login.workEmail": "Courriel professionnel",
  "login.emailVerificationIsRequired": "La vérification du courriel est obligatoire. Un lien de connexion seul ne donne pas accès à un espace de travail; l'accès nécessite une invitation du propriétaire.",
  "api.login.enterAValidEmail": "Saisissez une adresse courriel valide.",
  "api.invite.enterAValidEmail": "Saisissez une adresse courriel et un rôle valides.",
  "api.invite.inviteEmailDeliveryIs": "L'envoi des invitations par courriel n'est pas encore configuré.",
  "api.invite.thisEmailIsAlready": "Ce courriel appartient déjà à un membre de l'espace de travail.",
  "api.invite.anActiveInvitationAlready": "Une invitation active existe déjà pour ce courriel.",
  "studio.dropTheFilesYou": "Déposez les fichiers dont vous disposez : historique des ventes, fichier articles, liste des clients, grilles de coûts fournisseurs, listes de prix ou contrats de ristourne. Ils sont convertis en CSV propre dans ce navigateur et chargés dans votre coffre-fort chiffré. Rien n'est téléversé.",
  "studio.filesAdded": { one: "{count} fichier ajouté pour examen. Rien n'est téléversé.", other: "{count} fichiers ajoutés pour examen. Rien n'est téléversé." },
  "shell.report.body": "Un PDF de votre cascade et des principales fuites avec leurs lignes justificatives, généré sur cet appareil. Rien n'est téléversé; chaque export est consigné dans le journal d'audit.",
  "report.rebatehqMarginLeakReport2": "RebateHQ - Rapport des fuites de marge - généré sur cet appareil; rien n'a été téléversé",
  "margin.reportCreated": "Rapport des fuites PDF créé sur cet appareil ({bytes} octets); rien n'a été téléversé. L'export figure dans le journal d'audit.",
  "quotes.linesLabel": "Lignes de la soumission",
  "vendor.quotes": "Soumissions ouvertes concernées",
  "vendor.affectedQuotes": "Soumissions ouvertes concernées",
  "vendor.affectedQuotesHelp": "Lignes de soumissions en brouillon, soumises et en attente dont l'article change de coût : la marge au prix proposé avant et après.",
  "vendor.noQuotes": "Aucune soumission ouverte n'utilise un article dont le coût change.",
  "vendor.quoteCost": "Coût lors de la soumission",
  "vendor.openQuotes": "Soumissions ouvertes",
};
