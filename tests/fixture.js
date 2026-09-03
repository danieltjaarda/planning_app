// Verzonnen klanten voor de tests. Echte namen en telefoonnummers horen niet
// in een repository — zie de opmerking bij SEED_LEADS in de bron.
module.exports = [
  { id: "t-anna",  name: "Anna de Vries", phone: "+31 6 00000001",
    date: "2026-10-30", status: "wacht",   callDate: null,         callTime: null,    note: "Wacht op een datum." },
  { id: "t-bram",  name: "Bram Jansen",   phone: "+31 6 00000002",
    date: "2026-10-03", status: "wacht",   callDate: null,         callTime: null,    note: "" },
  { id: "t-anon",  name: "",              phone: "+31 6 00000003",
    date: null,         status: "gepland", callDate: "2026-09-02", callTime: "18:15", note: "Datum nog onbekend." },
  { id: "t-cas",   name: "Cas en Dina",   phone: "+31 6 00000004",
    date: "2026-05-29", status: "gebeld",  callDate: null,         callTime: null,    note: "Beslissen nog." },
  { id: "t-eva",   name: "Eva Bakker",    phone: "+31 6 00000005",
    date: "2026-10-05", status: "akkoord", callDate: "2026-09-04", callTime: null,    note: "Draaiboek doornemen." }
];
