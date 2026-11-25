# SZISZpong 🏓

A koli pingpong ELO-ranglistája. Telefonon a böngészőben megnyitva a
„Hozzáadás a kezdőképernyőhöz” gombbal appként is használható.

## Mi hol van?

| Fájl | Mit csinál |
|---|---|
| `index.html` | Az oldal váza |
| `style.css` | Kinézet, színek (a tetején a `:root` résznél könnyen átírhatók) |
| `js/main.js` | Indulás és élő frissítés (ezt tölti be az index.html); egy perc háttérben töltött idő után szünetelteti az élő kapcsolatot |
| `js/core.js` | Közös alapok: állapot, segédfüggvények, felugró ablakok, névválasztó |
| `js/data.js` | Adatok betöltése, alap statisztikák. A meccseket a telefon eltárolja, és csak az újakat kéri le; eltérésnél, admin javításnál és hetente egyszer mindent újratölt |
| `js/honors.js` | Különdíjak és achievementek kiszámolása |
| `js/honors-ui.js` | Különdíjak és achievementek megjelenítése, gratuláció |
| `js/router.js` | Melyik képernyő jelenjen meg |
| `js/auth.js` | Belépés, regisztráció |
| `js/ranking.js` | Ranglisták |
| `js/matches.js` | Meccsek lista, meccs részletek |
| `js/newmatch.js` | Új meccs rögzítése |
| `js/profile.js` | Profil, ELO-grafikon |
| `js/mystats.js` | Statisztikáim oldal |
| `js/admin.js` | Admin oldal |
| `config.js` | A Supabase-projekt címe és nyilvános kulcsa |
| `supabase/schema.sql` | Az adatbázis: táblák, ELO-számolás, belépés, admin funkciók (a kolis kód helyén itt csak egy helyőrző van, az igazi kódot az admin oldalon lehet állítani) |
| `.github/workflows/` | Napi ébresztő (hogy az ingyenes adatbázis ne aludjon el) és napi mentés a `backup/` mappába |
| `icons/` | Kezdőképernyős ikonok |

## ELO

Mindenki 1000 ponttal indul, a K-szám 32. Csak a győztes számít, az eredmény opcionális.
Egy győzelem értéke attól függ, mennyivel erősebb vagy gyengébb az ellenfél.

## Ha a Supabase mégis elaludna

Supabase → a projekt oldalán **Restore project**. Az adatok megmaradnak.
