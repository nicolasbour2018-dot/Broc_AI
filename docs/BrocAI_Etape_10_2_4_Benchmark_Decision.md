# BrocAI — Étape 10.2.4-F — Décision benchmark IA verrouillée

## Statut

**VERROUILLÉ pour la V1 brocante du 20 septembre 2026.**

Cette décision fige le routage IA issu du Prompt Lab et des benchmarks réels seller/assistant.
Elle ne prétend pas définir l'architecture définitive à long terme : un re-benchmark Qwen direct Alibaba reste prévu dès que l'accès au service sera disponible.

## 1. Principal — Gemini 3.5 Flash-Lite

`gemini-3.5-flash-lite` est le modèle principal de BrocAI.

Résultats observés sur le benchmark corrigé :

- 6/6 sorties structurées valides ;
- latence moyenne sur succès : 1 877,2 ms ;
- coût équivalent payant moyen : 0,000844 USD par succès ;
- meilleure combinaison observée de vitesse, stabilité, prudence et qualité utilisateur.

La priorité V1 est une expérience rapide et suffisamment qualitative pour une application exposée directement au public.

## 2. Fallback technique indépendant — Qwen via Hugging Face / DeepInfra

`Qwen/Qwen3.5-35B-A3B:deepinfra` est retenu comme fallback technique indépendant pour la V1.

Il est déclenché uniquement quand le principal ne peut pas produire une réponse exploitable pour une raison technique, notamment :

- timeout ;
- erreur réseau ;
- HTTP 429 ;
- HTTP 5xx ;
- réponse techniquement inutilisable.

Résultats observés :

- 5/5 appels réellement exécutés réussis ;
- latence moyenne sur succès : 9 251,6 ms ;
- coût estimé moyen : 0,001399 USD par succès.

Le sixième cas planifié n'a pas été exécuté : Hugging Face a retourné HTTP 402 après épuisement des crédits inclus. Ce cas ne doit pas être compté comme un échec Qwen.

Qwen n'est pas retenu comme principal pour la V1 en raison de sa latence via la route HF et d'une prudence qualitative moins régulière que Gemini 3.5. Il reste cependant suffisamment bon pour le rôle de secours.

## 3. Scale-up qualitatif — Gemini 3.6 Flash

`gemini-3.6-flash` n'est ni le principal ni le fallback technique.

Il est réservé à l'escalade qualitative lorsque Gemini 3.5 retourne une réponse **valide** avec :

`confidence == low`

Pour la V1, `medium` ne déclenche pas d'escalade.

Résultats observés :

- 4/6 sorties structurées valides lors du run mesuré ;
- latence moyenne sur succès : 6 795,6 ms ;
- coût équivalent payant moyen : 0,004043 USD par succès ;
- gain qualitatif visible sur certains cas difficiles, mais non systématique.

Une erreur technique du principal ne doit pas être routée vers 3.6 : les deux modèles dépendent de Google et 3.6 n'est pas une couche de résilience fournisseur.

## 4. Mode dégradé non-IA

Si Gemini 3.5 échoue techniquement et que le fallback Qwen/HF échoue également ou est indisponible, BrocAI passe en mode dégradé non-IA.

Le cœur de la brocante doit rester utilisable sans dépendre d'un modèle :

- consultation du marché ;
- navigation ;
- annonces déjà créées ;
- fonctions non-IA prévues par le périmètre V1.

## 5. Llama 4 Scout

Llama 4 Scout n'est pas retenu pour la V1.

Son coût observé est excellent et ses appels réellement exécutés ont été techniquement fiables, mais la revue aveugle montre une qualité rédactionnelle et une cohérence trop irrégulières pour une application présentée au public.

Il reste un candidat éventuel pour d'autres usages où coût et latence non critique priment sur la qualité rédactionnelle.

## 6. Routage V1 verrouillé

```text
Photo / demande IA
       |
       v
Gemini 3.5 Flash-Lite
       |
       +-- réponse valide + confidence medium/high --> réponse immédiate
       |
       +-- réponse valide + confidence low ---------> Gemini 3.6 Flash
       |                                                |
       |                                                +--> meilleure réponse exploitable
       |
       +-- erreur technique / timeout / 429 / 5xx ---> Qwen via HF / DeepInfra
                                                        |
                                                        +-- succès --> réponse fallback
                                                        |
                                                        +-- échec --> mode dégradé non-IA
```

## 7. Décision différée — Qwen direct Alibaba

Le benchmark HF a confirmé que Qwen est qualitativement suffisamment crédible pour justifier un test direct.

Dès que Model Studio Alibaba est accessible :

1. exécuter les mêmes cas seller/assistant ;
2. utiliser les mêmes prompts et schémas ;
3. mesurer latence, tokens, coût et stabilité ;
4. refaire une revue aveugle ;
5. réévaluer l'ordre `principal / fallback` seulement si les résultats directs le justifient.

Le prix théorique ne suffit pas à lui seul à renverser la décision actuelle.

## Sources internes du verrouillage

- `benchmarks/step10/results/gemini-pilot-20260918T235347Z.json`
- `benchmarks/step10/results/gemini-qualitative-review.md`
- `benchmarks/step10/results/multimodal-candidates-20260919T004848Z.json`
- `benchmarks/step10/results/multimodal-qualitative-review.md`
- `benchmarks/step10/production-routing.json`

## Conclusion

Pour la V1 :

**Principal : Gemini 3.5 Flash-Lite**  
**Fallback technique indépendant : Qwen via Hugging Face / DeepInfra**  
**Scale-up qualitatif : Gemini 3.6 Flash uniquement sur `confidence == low`**  
**Dernier filet : mode dégradé non-IA**

Cette décision clôt le benchmark 10.2.4.
