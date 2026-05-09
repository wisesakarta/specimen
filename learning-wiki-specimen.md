# Learning Wiki — Specimen OS

## 🏗️ Architecture: The Spatial Root (Peta Kota)
Specimen OS has transitioned from a flat layout to a **Layered Spatial Architecture**. Imagine the desktop as a city with multiple "floors":
- **Floor 0 (Icon Layer)**: Where the VFS icons live.
- **Floor 10 (Window Management Layer)**: A transparent plane where all applications hover.

By separating these, we ensure that a "building" (maximized window) can cover the entire city block without being restricted by the "sidewalk" (desktop padding).

## 🧠 Technical Decisions (Alasan Meng Mengapa)
### 1. Coordinate Normalization
**Why?** We moved from CSS `top/left` percentages to absolute `x/y` coordinates.
**Analogy**: It's like moving from giving directions as "20% from the west gate" to "exactly at coordinate (450, 300)". This prevents "drift" when the city (viewport) changes size or when we "warp" (maximize) to the origin.

### 2. Pointer Event Sovereignty
**Problem**: Maximized windows were "ghosts" that let you click through to the icons below.
**Fix**: We enforced `pointer-events: auto` on windows and ensured they perfectly "seal" the viewport using `inset-0` with a `-1px` bleed.

## 🖋️ Type Sovereignty: Departure Mono
Specimen OS has transitioned to a **Unified Technical Aesthetic** using [Departure Mono](https://github.com/rektdeckard/departure-mono).
- **Sole Typeface**: Replaced `MS Sans Serif` and `MM205` with Departure Mono for everything (Shell, Content, Branding).
- **Aesthetic Shift**: From pure Win95 emulation to a unique **Specimen Tech Sovereign** identity.
- **Materiality**: The monospaced pixel geometry reinforces the "technical specimen" feel of the application.

## ⚔️ War Stories (Bug & Perbaikan)
### The "Teal Gap" Mystery
**Bug**: A tiny 1px teal line appeared between windows and the taskbar.
**Perbaikan**: Sub-pixel antialiasing was causing a gap. We fixed this by adding a **-1px bottom bleed**, effectively making the window slightly overlap the taskbar's border.
**Lesson**: Sometimes, "Perfectness" requires a tiny, intentional imperfection (overlap).

### The "Control Hijack"
**Bug**: Clicking "Close" or "Maximize" would sometimes drag the window instead.
**Perbaikan**: The title bar was "stealing" the pointer event. We added **Propagation Blocks** (`e.stopPropagation()`) to all controls.
**Lesson**: In a sovereign runtime, always defend your buttons from their parents!

### The "Unified Type" Transition
**Decision**: Moving to a single monospaced font across the entire OS.
**Challenge**: Monospaced fonts take up more horizontal space in menus and title bars.
**Solution**: Adjusted system variables to allow Departure Mono to breathe within the legacy Win95 containers.

## 📜 Wisdom (Pelajaran Berharga)
- **Mechanical Instantaneity**: Win95 isn't about smooth fades; it's about instant material changes. Set `transition: { duration: 0 }` for that authentic technical calm.
- **Z-Index Discipline**: Never use ad-hoc z-indexes. Always rely on the centralized `maxZIndex` state to maintain the stacking order of citizens.

---

## Log Pembaruan: 2026-05-09 (Architectural Audit & Entropy Reduction)

### 🏗️ Arsitektur: Menuju Kedaulatan OS Sejati
Setelah melakukan audit arsitektur komprehensif bergaya Bell Labs, kita menemukan bahwa Specimen OS memiliki pondasi estetika yang kuat namun memiliki hutang struktural (entropy). Sistem saat ini masih terasa seperti aplikasi React raksasa, bukan sebuah sistem operasi.

Kita akan menerapkan **Roadmap Refactor 7-Fase**:
1.  **Naming Legitimacy**: Menyucikan nama variabel dari yang ambigu (`data`, `tmp`) menjadi jelas sesuai niat operasi.
2.  **Comment Legitimacy**: Menghapus komentar yang bersifat dekoratif atau lore-dumping menjadi rationale teknis yang dingin.
3.  **God Component Reduction**: Memecah `Win95Desktop.tsx` yang menangani semua hal (VFS, Window Management, Z-Index) menjadi sub-sistem yang terisolasi.
4.  **Runtime Sovereignty**: Mengkarantina aplikasi (citizen) agar tidak membocorkan state internal mereka ke Shell (pemerintah).
5.  **UI Primitive Normalization**: Menghilangkan prop-drilling di komponen UI.
6.  **State Topology**: Memastikan aliran data deterministik dan presisi.
7.  **Infrastructure Isolation**: Memisahkan API browser agar tidak langsung berinteraksi dengan layer OS.

### 🧠 Keputusan Teknis
**Mengapa membersihkan komponen God (`Win95Desktop`)?**
**Analogi**: Saat ini, walikota (Win95Desktop) secara langsung mengatur lalu lintas jalan, menyalakan lampu jalan, dan membangun rumah warga. Ini membuat kebingungan dan beban berlebih (cognitive overload). Keputusannya adalah mendelegasikan tugas-tugas ini ke dinas yang terpisah (Hooks / State Machines), sehingga walikota hanya fokus pada pandangan tingkat tinggi (orchestration/view rendering).

### 🐛 Cerita Perang: The God Component Tangle
**Kondisi**: Sebuah komponen dengan panjang lebih dari 1000 baris yang memanipulasi z-index secara brute force (`normalizeZIndexes`) untuk memaksa window tampil di depan.
**Pelajaran (Lesson)**: Jika Anda harus menulis fungsi `normalizeX` yang dijalankan secara rekursif atau brute force di setiap render, itu artinya arsitektur state Anda tidak deterministik. Kedaulatan ruang (Spatial Sovereignty) harus teratur, bukan dipaksakan.

---

## Log Pembaruan: 2026-05-09 (Phase 1 - Persistence Deduplication)

### 🧠 Keputusan Teknis: Otoritas Tunggal Penyimpanan Sesi
**Mengapa memisahkan Load dan Save ke dalam hook khusus?**
**Analogi**: Bayangkan memiliki dua pustakawan yang sama-sama mencoba menyusun buku di rak yang sama, di waktu yang sama, tanpa berkomunikasi. Kekacauan (Race condition) pasti terjadi! Dengan memusatkan `loadSessionSnapshot()` dan `useSessionSave()` ke dalam satu otoritas tunggal (Hook `useSessionPersistence`), kita memastikan hanya ada satu "Buku Induk" yang mencatat dan mengembalikan data (Deterministic State).

### 🐛 Cerita Perang: Misteri VFS yang Menghilang
**Bug**: Terkadang file atau pengaturan baru tidak tersimpan jika pengguna melakukan refresh terlalu cepat.
**Penyebab**: Terdapat dua rutinitas penyimpanan yang bersaing (satu berjalan otomatis, satu tertunda 500ms). Rutinitas kedua secara tidak sengaja "lupa" untuk menyimpan sistem file (VFS), sehingga menimpa penyimpanan yang benar dengan penyimpanan tanpa VFS.
**Perbaikan**: Menghapus duplikasi dan menggantinya dengan efek penyimpanan debounced tunggal yang diawasi penuh, memastikan bahwa seluruh topologi (Windows, Recents, VFS) disimpan dalam satu transaksi yang dijamin keamanannya oleh "Hydration Gate" (`mounted`).
**Pelajaran (Lesson)**: Kapanpun sebuah efek (*effect*) React mengakses state yang dinamis, periksa *Dependency Array*. Stale closures (penggunaan data yang usang dalam fungsi) akan menelan data Anda tanpa peringatan!

---

## Log Pembaruan: 2026-05-09 (Phase 2 - Window Manager Extraction)

### 🏗️ Arsitektur: Kedaulatan Tata Kelola Ruang
**Pencabutan Wewenang Desktop (`Win95Desktop`)**
Kita telah melakukan operasi pemisahan wewenang. `Win95Desktop` yang sebelumnya mengatur tata letak, data file (VFS), DAN segala interaksi jendela (Buka, Tutup, Fokus, Z-Index) telah dipreteli. Segala tata kelola ruang dan jendela kini diisolasi ke dalam `useWindowManager`. 
**Analogi**: Kita baru saja mendirikan "Dinas Tata Kota" (`useWindowManager`). Walikota (`Win95Desktop`) kini hanya menerima peta dari dinas tersebut dan menampilkan hasilnya, bukan lagi menggambar peta itu sendiri secara manual setiap detiknya.

### 🧠 Keputusan Teknis: Mutasi State Berbasis Fungsi (Functional Updaters)
**Kenapa beralih dari `setWindows(newWindows)` ke `setWindows(prev => ...)` secara ketat di manajemen Z-Index?**
Manajemen Z-Index adalah operasi matematika yang sangat sensitif terhadap tumpang tindih waktu (race condition). Membaca state, melakukan komputasi, lalu menulisnya kembali sering kali salah karena state asal mungkin sudah kedaluwarsa sebelum penulisan selesai. Penggunaan *functional updater* menjamin bahwa manipulasi array jendela selalu menggunakan data terakurat dan terbaru di detik eksekusi.

### 🐛 Cerita Perang: Tabrakan Normalisasi (The Overwrite Bug)
**Bug**: Saat banyak jendela dibuka hingga indeks Z menembus batas (>800), fungsi fokus tiba-tiba membuat jendela tumpang tidih secara kacau.
**Penyebab**: Fungsi `normalizeZIndexes` memanggil `setWindows` secara sinkron. Namun tepat di baris berikutnya, fungsi `focusWindow` juga memanggil `setWindows`. Pemanggilan kedua menimpa (*overwrite*) hasil komputasi ulang pemanggilan pertama.
**Perbaikan**: Seluruh logika yang melibatkan indeks dinamis Z di `useWindowManager` dipaksa menggunakan *functional updaters*. Dengan demikian React akan mengantrekan perubahan dengan aman tanpa saling menimpa.
**Pelajaran (Lesson)**: Jangan pernah mengandalkan referensi array yang ada di luar *scope* saat Anda melakukan mutasi berturut-turut dalam satu siklus yang sama. Selalu gunakan `setSesuatu(prev => ...)`.

---

## Log Pembaruan: 2026-05-09 (Post-Phase 2 Stabilization & Constitutional Cleanup)

### 🧠 Keputusan Teknis: Otoritas Penamaan dan Komentar (Legitimacy Doctrine)
**Kondisi**: Selama fase refactor, banyak komentar yang merujuk pada "Phase 3" atau menjelaskan proses migrasi ("Hook ini menggantikan pattern lama...").
**Tindakan**: Seluruh narasi migrasi dan referensi roadmap dihapus dari *source code*. Komentar diubah menjadi murni *technical rationale* yang menjelaskan alasan operasional, bukan menceritakan sejarah pengerjaan.
**Pelajaran (Lesson)**: *Production code is an engineering environment, not a narrative space.* Kode yang baik tidak boleh memuat buku harian sang pemrogram. Komentar hanya diizinkan untuk menjelaskan *mengapa* sebuah keputusan teknis dibuat (contoh: "Functional updater memastikan Z-index deterministik").

### 🏗️ Arsitektur: Pengakuan Ketegangan Sementara (Deferred Tension)
**Kondisi**: Logic manajemen untuk jendela aplikasi utama (Desktop Windows) dan jendela Specimen (Special Case) masih terpisah (`maxZIndex` vs `specimenZIndex`).
**Keputusan**: Ketegangan arsitektur ini sengaja *dipertahankan* pada tahap stabilisasi ini. Kita tidak melakukan "over-engineering" untuk menyelesaikan masalah yang merupakan wilayah kerja Phase 3. 
**Pelajaran (Lesson)**: Stabilisasi berarti memastikan apa yang telah dipisahkan berjalan dengan kuat dan berdaulat. Memperbaiki *desain* arsitektural (Phase 3) pada saat stabilisasi (Post-Phase 2) adalah sebuah pelanggaran batasan tugas.

---

## Log Pembaruan: 2026-05-09 (Terminal Functional Binding & Operational Instrument)

### 🏗️ Arsitektur: Kedaulatan Antar-Sistem (Fullscreen State)
Kita telah meningkatkan infrastruktur **Sovereign Dispatch**. Sekarang, setiap jendela memiliki kemampuan untuk memicu perubahan status global mereka sendiri melalui prop `onMaximize`.
**Analogi**: Kita baru saja memberikan "tombol darurat" (emergency button) kepada setiap warga (citizen) agar mereka bisa meminta pemerintah (shell) untuk memberikan mereka seluruh panggung (fullscreen) tanpa harus menunggu pengguna menekan tombol di title bar.

### 🛠️ Keputusan Teknis: Mekanika Jujur (Functional Toolbar)
Terminal bukan lagi sekadar pajangan. Seluruh tombol toolbar kini terikat ke API operasional:
- **Font Cycling**: Mengubah ukuran font secara dinamis (12->14->16px).
- **Clipboard Integration**: Tombol Copy/Paste kini terhubung langsung ke `navigator.clipboard` dan selection buffer xterm.js.
- **Phosphor Mode**: Implementasi filter visual CRT (garis-garis fosfor) untuk meningkatkan resonansi atmosferik.
- **Properties Overlay**: Menyediakan metadata instrospeksi teknis tentang runtime yang sedang berjalan.

### 🐛 Cerita Perang: The "Invisible Maximize" Prop
**Bug**: Tombol "Fullscreen" di terminal awalnya tidak berfungsi karena komponen Terminal tidak memiliki cara untuk memberitahu Shell bahwa ia ingin menjadi besar.
**Perbaikan**: Kita melakukan refactor pada `SovereignRuntimeProps` dan `DispatchSovereignCitizen` di seluruh sistem (Webamp, Monaco, Notepad, Paint, Browser) untuk menyertakan `onMaximize`. Ini memastikan seluruh sistem memiliki bahasa komunikasi yang seragam.
**Pelajaran (Lesson)**: Dalam sistem operasi, **konsistensi kontrak** lebih penting daripada fitur individu. Menambahkan satu fitur ke satu aplikasi seringkali membutuhkan standarisasi di tingkat infrastruktur pusat.

### 🦉 Kebijaksanaan (Pelajaran Berharga)
- **Mechanical Honesty Over Hacker Roleplay**: Perintah `TASKS` dan `KILL` di terminal benar-benar memanipulasi jendela yang ada di layar. Jika Anda mematikan proses via terminal, jendelanya benar-benar hilang. Ini memvalidasi bahwa Terminal adalah **instrumen kontrol**, bukan sekadar hiasan.
- **Constraint Legitimacy**: Mempertahankan font monospaced (Berkeley Mono) dan layout kaku adalah cara kita menghormati "Operational Calm". Antarmuka yang tenang dan deterministik jauh lebih bernilai daripada antarmuka yang penuh dengan animasi yang tidak perlu.

---

## Log Pembaruan: 2026-05-09 (Post-Phase 7/8 Topology Stabilization Audit)

### 🏗️ Arsitektur: Restorasi Batas Kedaulatan (Sovereignty Boundaries)
Audit ini dilakukan untuk menangani "Framework Gravity" yang mulai menarik sistem kembali ke arah paradigma aplikasi web biasa. Kita menemukan pelanggaran kedaulatan di mana Shell (pemerintah) mencoba mencari tahu isi pikiran Jendela (citizen) untuk menentukan subtitle.
- **Dinas Kependudukan Terpusat**: `DEFAULT_VFS` dipindahkan dari `os-config.ts` ke `vfs-init.ts`.
- **Subtitle Sovereignty**: Jendela kini berdaulat untuk melaporkan subtitle mereka sendiri melalui kontrak `onActivityChange`. Shell tidak lagi melakukan inspeksi konten ilegal.

### 🧠 Keputusan Teknis: Otoritas Tunggal Resolusi Konten
**Mengapa menyatukan ekstraksi konten teks?**
**Analogi**: Sebelumnya, setiap aplikasi (Notepad, Monaco) memiliki cara masing-masing untuk membuka surat dari VFS. Kita menyatukannya menggunakan `extractRuntimeTextPayload`. Sekarang, semua aplikasi menggunakan "alat pembuka surat" yang sama, memastikan cara membaca data dari VFS bersifat deterministik dan tidak bergantung pada aplikasi.

### 🐛 Cerita Perang: The "Illegal Knowledge" Violation
**Bug**: `runtime-dispatch.tsx` berisi logika yang sangat spesifik untuk Monaco (`//` comments) and Notepad (line find). 
**Masalah**: Ini adalah pelanggaran kedaulatan. Jika kita menambah aplikasi baru, kita harus mengubah Shell. Ini membuat Shell menjadi "God Component" yang tahu segalanya.
**Perbaikan**: Logika ekstraksi subtitle dipindahkan ke dalam masing-masing aplikasi. Aplikasi sekarang "berteriak" ke Shell: "Halo, subtitle saya sekarang adalah ini!". Shell hanya mendengarkan dan menampilkannya tanpa perlu tahu bagaimana subtitle itu dibuat.
**Pelajaran (Lesson)**: *The Shell governs space and lifecycle; the Citizen executes its domain.* Jangan biarkan Shell mengintip ke dalam implementasi detail Citizen.

### 🦉 Kebijaksanaan (Pelajaran Berharga)
- **Locality of Understanding**: Jika sebuah file konfigurasi (`os-config.ts`) sudah berisi 300 baris data statis, segera pisahkan. Data statis bukan merupakan bagian dari logika tata kelola sistem.
- **Sovereign Contracts**: Gunakan event emitters (`onActivityChange`) sebagai satu-satunya jembatan informasi antara Shell dan Citizen. Hindari manipulasi data pasif yang bersifat menduga-duga.

---

## Log Pembaruan: 2026-05-09 (Runtime Synchronization Stabilization — Critical Hotfix)

### 🐛 Cerita Perang: The Render Loop Catastrophe
**Bug**: `Maximum update depth exceeded` — the entire OS froze immediately on opening Notepad.
**Penyebab**: A **three-layer synchronization defect** created an infinite feedback loop:

1. **Layer 1 — Callback Instability (Shell)**: `Win95Desktop` created `onActivityChange` as an anonymous closure inside `windows.map()`. Every rerender produced a new function identity.
2. **Layer 2 — Effect Coupling (Citizen)**: Notepad's activity emission effect included `onActivityChange` in its dependency array. A new reference triggered re-execution.
3. **Layer 3 — Missing Deduplication (Orchestrator)**: `updateWindowState` blindly applied every patch, always producing a new array reference — even for identical activity states.

**Analogi**: Imagine a town crier (Notepad) who shouts "I have news!" every time the mayor (Shell) looks at him. The mayor, hearing the shout, turns to look. The crier, seeing the mayor look, shouts again. Forever.

**Perbaikan (Three-Layer Fix)**:
1. **Container Stabilization**: Extracted `SovereignWindowRuntime` component with `useCallback` to produce stable callback references.
2. **Ref Decoupling**: Changed citizen effects to use `onActivityChangeRef.current` with `[content]`-only dependency arrays.
3. **Orchestrator Guard**: Added structural equality check in `updateWindowState` — if `activity.dirty` and `activity.subtitle` are unchanged, return `prev` (same array reference = no rerender).

**Pelajaran (Lesson)**: In React, the coupling between effect dependencies and callback identity is the most dangerous source of infinite loops. The fix must address ALL layers simultaneously:
- **Stabilize** the callback source (producer).
- **Decouple** the callback consumer from reference identity.
- **Guard** the state mutation to reject no-op updates.

Fixing only one layer may reduce loop frequency but not eliminate it.

### 🦉 Kebijaksanaan
- **Never include callback props in effect dependency arrays**. Use refs to capture the latest callback and depend only on the data that drives the emission.
- **Always guard state updates with structural equality**. If the proposed state is identical to the current state, return the existing reference. React only skips rerenders if the state reference is === identical.
- **Sovereignty requires stable contracts**. When a Shell passes callbacks to Citizens, those callbacks must be referentially stable. Extract dedicated components or use `useCallback` with primitive dependencies.

---

## Log Pembaruan: 2026-05-09 (Presentation Layer Audit)

### 🏙️ Arsitektur (Peta Kota): Sovereign Runtime Surface
Specimen OS bukanlah sekadar kumpulan komponen React; ia adalah permukaan runtime yang berdaulat. Bayangkan ini seperti panggung teater: `Win95Desktop` adalah batasan fisiknya (panggung), sementara setiap jendela adalah aktor berdaulat yang memiliki naskah dan kehidupannya sendiri.
- **Sovereign vs Managed Citizens**: Aplikasi "Sovereign" mengatur detak jantung dan siklus hidupnya sendiri, sementara aplikasi "Managed" diatur penuh oleh OS. 

### 🛠️ Keputusan Teknis (Alasan Mengapa)
**Mengapa menggunakan animasi mekanis dan bukan fluid transitions?**
Kita menggunakan parameter `dragElastic={0}` dan `dragMomentum={false}` di Framer Motion, serta transisi material (seperti `brightness` sesaat).
**Analogi**: Kita tidak ingin mensimulasikan antarmuka sentuh modern yang licin seperti es. Kita ingin mensimulasikan tabung CRT berat dan komponen fisik mekanik (sakelar). Saat tombol diklik, perubahannya seketika (instant) melalui manipulasi *box-shadow*. Ini memberikan "tactile consequence" (konsekuensi sentuhan) yang memvalidasi realitas material sistem.

### 🐛 Cerita Perang (Bug & Perbaikan)
**Penyakit "Tumpang Tindih" (The Z-Index Overflow)**
**Kondisi**: Seiring pengguna terus membuka dan menutup jendela, indeks Z (kedalaman) terus merambat naik tanpa batas, yang berpotensi merusak aliran *rendering* DOM browser.
**Perbaikan**: Fungsi `normalizeZIndexes` memantau indeks ini. Jika melampaui batas tertentu (800), sistem secara transparan melakukan kompresi dan re-mapping massal, menekan semua nilai Z kembali ke basis indeks 100 dengan mempertahankan topologi spasial relatifnya.
**Pelajaran**: Sistem tata letak yang berdaulat membutuhkan mekanisme normalisasi internal yang otonom untuk menjaga integritas struktural, mirip dengan *garbage collector* untuk pengelolaan memori.

### 🦉 Kebijaksanaan (Pelajaran Berharga)
- **Token CSS Material Bukan Abstrak**: Penamaan `--win-face` memaksa kita berpikir secara fisik ("wajah panel padat"), berbeda dengan penamaan web modern generik seperti `--primary-color`. Ini menanamkan *mindset* bahwa kita sedang menyusun bongkahan logam di layar.
- **Micro-Legitimacy**: Perhatian terhadap kursor adaptif (`wait`, `text`, `nwse-resize`) dan *structural beveling* (efek 3D timbul 4-warna tajam) bukanlah sekadar kosmetik retro; itu adalah infrastruktur operasional. Tanpanya, ilusi kedaulatan mesin akan hancur seketika.

---

## Log Pembaruan: 2026-05-09 (Browser Citizen Constitutional Audit)

### 🏙️ Arsitektur (Peta Kota): Network Viewport
Browser di dalam SPECIMEN OS **bukanlah sebuah Chrome Clone** atau platform aplikasi web modern. Ia adalah sebuah **Network Viewport** (Jendela Pemantau Jaringan). 
**Analogi**: Jika SPECIMEN OS adalah sebuah kapal selam penelitian, maka browser adalah jendela kapal (porthole) berlapis baja. Anda bisa melihat keluar ke lautan internet yang liar, tapi air laut tidak boleh membanjiri dan menenggelamkan kapal Anda.

### 🛠️ Keputusan Teknis (Alasan Mengapa)
**Mengapa melarang "Tabs", "Bookmarks", dan "Extensions" di dalam Browser?**
Karena SPECIMEN OS itu sendiri adalah sistem operasinya! 
- Multitasking dilakukan melalui **Jendela OS**, bukan Tab Browser.
- Penyimpanan URL dilakukan melalui **File Sistem (VFS)**, bukan Bookmark Browser.
Fungsi-fungsi psikologi penahan perhatian (attention-capture) dari browser modern secara tegas dilucuti demi mempertahankan *kedaulatan lingkungan* SPECIMEN.

### 🐛 Cerita Perang (Bug & Perbaikan)
**Penyakit "Webpage Dominance" (Invasi Ruang Visual)**
**Risiko**: Halaman web modern sering mencoba mendominasi seluruh *viewport*, membuat pengguna lupa bahwa mereka berada di dalam sebuah OS.
**Pencegahan**: Implementasi *strict iframe containment* dengan bingkai material yang tebal dan *address bar* yang sangat kaku. Ini adalah batas fisik yang terus-menerus mengingatkan pengguna: "Anda sedang menggunakan mesin mekanik SPECIMEN yang memantau sebuah web, bukan sedang menjelajahi web".

### 🦉 Kebijaksanaan (Pelajaran Berharga)
- **Psikologi Infrastruktur**: Desain antarmuka bisa membentuk psikologi pengguna. Browser SPECIMEN didesain untuk terasa **kaku, mekanis, dan dingin**—seperti terminal perpustakaan—untuk mencegah pengguna jatuh ke dalam "lubang hitam scroll tanpa batas" (infinite scroll immersion). Ini adalah bukti bahwa *constraint* (batasan) adalah sebuah fitur (feature).

---

## Log Pembaruan: 2026-05-09 (Browser Citizen Refinement)

### 🏙️ Arsitektur (Peta Kota): Instrumen Mekanis
Saat kita membuat *loading state* (kondisi pemuatan) untuk Web Browser, kita tidak menggunakan *spinner* animasi modern atau *skeleton UI* yang halus. Sebaliknya, kita menggunakan `Win95ProgressBar` (bilah progres kotak-kotak). 
Ini mempertegas posisi arsitektural browser: **sebuah instrumen mekanis, bukan layanan web modern**. Browser di SPECIMEN adalah alat komunikasi jarak jauh yang kasar, bukan jendela portal gaib.

### 🛠️ Keputusan Teknis (Alasan Mengapa)
**Mengapa menyembunyikan Iframe saat Loading atau Error?**
Kita menggunakan CSS untuk menyembunyikan `iframe` dan menampilkan UI error berdesain Win95 bawaan OS.
**Alasannya**: Kita harus menutupi "kekacauan bawaan browser" (seperti halaman *sad face* Chrome atau peringatan keamanan Firefox) agar pengguna tetap merasa sepenuhnya berada di dalam SPECIMEN OS. *Failure state* (kondisi gagal) harus dikendalikan oleh sistem operasi, menjaga wibawa (dignity) dari ilusi arsitektur.

### 🐛 Cerita Perang (Bug & Perbaikan)
**Jebakan Buta X-Frame-Options**
**Risiko**: Sebuah website mungkin menolak ditampilkan di dalam iframe (misal: Google.com memiliki `X-Frame-Options: DENY`). Namun, browser modern akan diam-diam menolaknya dan tetap memicu *event* `onLoad` seolah-olah sukses.
**Perbaikan**: Kita menggabungkan dua cara: pre-flight `fetch` dengan `mode: 'no-cors'` untuk memastikan jaringan benar-benar terhubung (bukan DNS error), dan mengecek apakah isi iframe dipaksa menjadi `about:blank`. Sistem SPECIMEN lalu akan merampas kembali layar tersebut dan mengatakan *"Rendering prohibited by remote policy."*

### 🦉 Kebijaksanaan (Pelajaran Berharga)
- **Error yang Bermartabat (Dignified Errors)**: Saat sistem gagal, pesan teks (copywriting) yang Anda gunakan sangatlah penting. *"Network connection unavailable"* terasa berwibawa, dingin, dan murni seperti protokol jaringan. Jika kita menggunakan gaya *startup* modern seperti *"Oops, something went wrong 😢"*, maka realitas mekanis SPECIMEN akan langsung hancur seketika. **Bahasa adalah bagian dari antarmuka.**

---

## Log Pembaruan: 2026-05-09 (Terminal Citizen Constitutional Audit)

### 🏙️ Arsitektur (Peta Kota): Introspection Surface
Terminal di SPECIMEN OS **bukanlah mainan hacker** atau sekadar dekorasi bergaya *Matrix*. Terminal adalah sebuah **Introspection Surface** (Permukaan Introspeksi) dan **Procedural Interface**.
**Analogi**: Terminal ini seperti ruang mesin kapal. Di sini tidak ada lampu neon disko; yang ada hanyalah pipa, katup, dan meteran tekanan yang jujur (Virtual File System dan Runtime State). Anda melihat mesin tanpa pelindung.

### 🛠️ Keputusan Teknis (Alasan Mengapa)
**Mengapa melarang "Hacker Roleplay" dan "Fake Boot-Logs"?**
Karena SPECIMEN adalah operasi realitas komputasi, bukan teater. Jika terminal mengeluarkan teks, itu karena ada file nyata yang sedang dibaca atau proses operasional yang sedang berjalan. Melarang animasi "decrypting" palsu atau rentetan ANSI yang tidak bermakna adalah cara kita mempertahankan *Operational Honesty* (Kejujuran Operasional).

### 🐛 Cerita Perang (Bug & Perbaikan)
**Penyakit "Performative Identity" (Kosplay Hacker)**
**Risiko**: Desainer UI sering tergoda menambahkan fitur-fitur fiktif (seperti `ping` yang hanya me-loop angka acak atau perintah `sudo` buatan) agar terminal terlihat "canggih" di mata pengguna.
**Pencegahan**: Audit konstitusional ini dengan tegas melarang *fake complexity* (kompleksitas palsu). Terminal dilarang keras memiliki perintah hiburan. Terminal harus menjadi instrumen sistem yang otentik.

### 🦉 Kebijaksanaan (Pelajaran Berharga)
- **Kesunyian adalah Otoritas (Silence is Authority)**: Mengikuti filosofi murni administrasi sistem, terminal yang berwibawa harus bisa menghargai keheningan. Jika sebuah perintah berhasil dieksekusi, ia tidak perlu memamerkan pesan "Berhasil! 🎉". Ketiadaan pesan *error* adalah konfirmasi keberhasilan mekanis tertinggi. Biasakanlah untuk tidak cerewet dalam merancang instrumen presisi.

## Terminal Citizen — Stage 1 Implementation (2026-05-09)

### The Procedural Introspection Surface
The Terminal has been integrated not as a "hacker app," but as a workstation-grade introspection instrument. It follows the **Vessel** architecture—managed Win95 chrome hosting a sovereign xterm.js substrate.

### Commands as Sovereignty Enforcers
- **`dir`/`cd`**: Directly traverse the React-state VFS, proving that the file system is an operational reality, not just a visual representation in Explorer.
- **`run`/`open`**: Procedural app spawning. This decouples app launching from purely mouse-driven interactions, reinforcing the OS's runtime legitimacy.
- **`tasks`**: Direct introspection into the `runtimeSnapshots` state, allowing the system to observe its own active citizens.

### Technical Standard Cadence
- **Instant Response**: Commands execute with 0ms delay, reflecting the deterministic nature of the local runtime.
- **Visual Calm**: Berkeley Mono typography on a solid black background, adhering to the high-contrast technical aesthetic of the project.
- **Structural Integrity**: Full synchronization between terminal state (CWD) and the prompt, ensuring the user always knows their spatial location in the VFS.

### Engineering Wisdom
- **Xterm.js as Display Only**: Treat xterm.js purely as a CRT display mechanism. All parsing, command logic, and state management must be authored within the React environment to ensure full control over the SPECIMEN experience.
- **Focus Semantics**: Ensuring the terminal captures input correctly without interfering with window manager global hotkeys or drag events is critical for multi-tasking legitimacy.

## Runtime Launch Topology Normalization (2026-05-09)

### VFS vs. Procedural Launching
The system now strictly separates **VFS-backed launching** (opening a file artifact) from **Procedural citizen spawning** (launching an app by type). This prevents "undefined" crashes and ensures the runtime remains deterministic.

### Icon Authority
By centralizing default icon metadata in the `SOVEREIGN_REGISTRY`, we've restored icon authority across the entire civilization surface. Whether an app is opened from a Desktop icon, the Start Menu, or a Terminal command, its pixel-art identity remains consistent and legitimate.

### Engineering Wisdom
- **Safety Over Assumptions**: Never assume a `find()` on a global state (like VFS) will succeed, especially in UI callbacks like the Start Menu. Always implement safety guards and fallback flows.
- **Ontological Purity**: Maintain clear boundaries between system entities. A "File" in the VFS is not the same as an "App" in the registry, even if the file points to the app. Spawning should use the most direct authority available.

---

## Log Pembaruan: 2026-05-09 (Terminal Fidelity & Win95 Toolbar)

### 🏗️ Arsitektur: Kedaulatan Terminal (Vessel Class Refinement)
Terminal SPECIMEN OS kini telah mencapai tingkat fidelitas yang setara dengan **MS-DOS Prompt Windows 95**. Kita telah membuang seluruh dependensi Tailwind CSS yang tersisa di dalam citizen Terminal, menggantinya dengan sistem styling yang berdaulat (Sovereign CSS) menggunakan token kanonik (`--win-face`, `--bevel-raised`).
**Analogi**: Kita baru saja merenovasi interior pusat kendali (Terminal) dari material plastik modern (Tailwind) menjadi material baja dan silikon asli (CSS Native). Ini memastikan terminal terasa seperti instrumen permanen, bukan sekadar "tema" web.

### 🛠️ Keputusan Teknis: Simulasi MS-DOS 8.3 & Toolbar Mekanis
1. **8.3 Filename Simulation**: Kita mengimplementasikan algoritma `toShortName()` untuk simulasi batasan historis DOS. 
   - **Kenapa?** Untuk memberikan kesan "Materiality" yang otentik. Melihat `PROGRA~1` memberikan resonansi emosional dan teknis bahwa kita berada di lingkungan workstation klasik.
2. **Win95 Toolbar**: Menambahkan toolbar klasik (Font, Mark, Copy, Paste, Fullscreen, Properties, Background).
   - **Kenapa?** Toolbar ini adalah penanda visual (landmark) MS-DOS Prompt yang paling ikonik. Tanpanya, terminal hanyalah sebuah kotak hitam. Ini memvalidasi kedaulatan visual sistem.
3. **Command Expansion**: Menambahkan perintah `PROMPT` untuk memungkinkan kustomisasi identitas sesi, dan memperluas perintah `DIR` untuk menampilkan detail yang lebih teknis.

### 🐛 Cerita Perang: The "Tailwind Shadow" Refactoring
**Bug**: Sebelumnya, Terminal memiliki margin dan padding yang ditentukan oleh kelas Tailwind (`m-4`, `p-2`). Ini menyebabkan Terminal "mengambang" secara tidak stabil di dalam container Win95-nya.
**Perbaikan**: Menghapus seluruh kelas utility Tailwind dan beralih ke layout `flex` murni dengan unit `px` dan token CSS. Hasilnya adalah presisi pixel-perfect yang tidak lagi "bergoyang" saat jendela di-resize.
**Pelajaran (Lesson)**: Jangan gunakan framework utilitas (Tailwind) untuk komponen yang membutuhkan kontrol spatial mutlak. *Utility classes are for rapid prototyping; canonical CSS is for sovereign engineering.*

### 🦉 Kebijaksanaan (Pelajaran Berharga)
- **Continuity of History**: Menambahkan **Persistent Command History** menggunakan `localStorage`. Sebuah OS yang "lupa" apa yang Anda ketik 5 menit yang lalu setelah di-refresh adalah OS yang tidak memiliki integritas ingatan. *Persistence is the soul of software craftsmanship.*
- **8.3 Logic**: Batasan (constraints) bukan hanya tentang teknis, tapi tentang estetika. Menampilkan nama file yang terpotong (`~1`) justru meningkatkan nilai legitimasi sistem di mata pengguna profesional.
