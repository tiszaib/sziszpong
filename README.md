# SZISZpong 🏓

A koli pingpong ELO-ranglistája. Telefonon a böngészőben megnyitva a
„Hozzáadás a kezdőképernyőhöz” gombbal appként is használható.

## Mi hol van?

| Fájl | Mit csinál |
|---|---|
| `index.html` | Az oldal váza |
| `style.css` | Kinézet, színek (a tetején a `:root` résznél könnyen átírhatók) |
| `app.js` | Az app logikája: ranglista, élő meccsfolyam, meccsrögzítés, profil, admin |
| `config.js` | A Supabase-projekt címe és nyilvános kulcsa |
| `supabase/schema.sql` | Az adatbázis: táblák, ELO-számolás, belépés, admin funkciók (a kolis kód helyén itt csak egy helyőrző van, az igazi kódot az admin oldalon lehet állítani) |
| `.github/workflows/` | Napi ébresztő (hogy az ingyenes adatbázis ne aludjon el) és napi mentés a `backup/` mappába |
| `icons/` | Kezdőképernyős ikonok |

## ELO

Mindenki 1000 ponttal indul, a K-szám 32. Csak a győztes számít, az eredmény opcionális.
Egy győzelem értéke attól függ, mennyivel erősebb vagy gyengébb az ellenfél.

## Ha a Supabase mégis elaludna

Supabase → a projekt oldalán **Restore project**. Az adatok megmaradnak.
