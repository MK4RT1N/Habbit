// State Management backed by API
let state = {
    habits: [],
    tasks: [],
    streak: 0
};
let lastServerStateJson = "";
let pendingRequests = 0;
let selectedDays = [];

// Selectors
const getEl = (id) => document.getElementById(id);

// Init
document.addEventListener('DOMContentLoaded', () => {
    // Try to load initial state from variable if present
    if (typeof INITIAL_STATE !== 'undefined') {
        state = { ...INITIAL_STATE };
        lastServerStateJson = JSON.stringify(state);
        render(); // Optimistic load
    }

    // Initial Sync
    syncState();

    // Start Polling Loop (every 2 seconds) for real-time updates
    setInterval(() => {
        if (pendingRequests === 0) {
            syncState(true);
        }
    }, 2000);

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }

    populateTaskDates();
});

function populateTaskDates() {
    const sel = getEl('new-task-date');
    if (!sel) return;
    sel.innerHTML = '';

    const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);

        let label = "";
        if (i === 0) label = "Heute";
        else if (i === 1) label = "Morgen";
        else label = days[d.getDay()] + ` ${d.getDate()}.${d.getMonth() + 1}.`;

        const opt = document.createElement('option');
        opt.value = i;
        opt.innerText = label;
        sel.appendChild(opt);
    }
}

// Render Hero Stats
const totalHabits = state.habits.length;
let completedHabits = 0;
state.habits.forEach(h => {
    if (h.current >= h.target) completedHabits++;
});

const pct = totalHabits > 0 ? Math.round((completedHabits / totalHabits) * 100) : 0;

if (getEl('hero-percentage')) getEl('hero-percentage').innerText = `${pct}%`;
if (getEl('hero-progress-text')) getEl('hero-progress-text').innerText = `${completedHabits} von ${totalHabits} erledigt`;
if (getEl('hero-bar')) getEl('hero-bar').style.width = `${pct}%`;

// Circle Progress (Stroke-dasharray logic: 100 is full)
if (getEl('hero-circle-path')) {
    getEl('hero-circle-path').setAttribute('stroke-dasharray', `${pct}, 100`);
}

// Render Habits
if (habitList) {
    habitList.innerHTML = '';
    state.habits.forEach((habit, index) => {
        const div = document.createElement('div');
        const isCompleted = habit.completed;
        const progress = habit.target > 1 ? `${habit.current}/${habit.target}` : '';

        // Icon selection based on text (simple heuristic for MVP)
        let icon = 'circle';
        if (habit.text.toLowerCase().includes('run') || habit.text.toLowerCase().includes('lauf')) icon = 'directions_run';
        else if (habit.text.toLowerCase().includes('wats') || habit.text.toLowerCase().includes('wasser')) icon = 'water_drop';
        else if (habit.text.toLowerCase().includes('read') || habit.text.toLowerCase().includes('les')) icon = 'menu_book';
        else if (habit.text.toLowerCase().includes('sleep') || habit.text.toLowerCase().includes('schlaf')) icon = 'bedtime';
        else if (habit.text.toLowerCase().includes('medit')) icon = 'self_improvement';

        const activeClass = isCompleted
            ? 'bg-primary border-primary text-[#0d1b12]'
            : 'border-gray-200 dark:border-gray-600 text-transparent hover:border-primary hover:text-primary';

        const titleClass = isCompleted ? 'opacity-50 line-through decoration-2 decoration-primary/50' : '';

        div.className = "group flex items-center gap-4 p-3 bg-surface-light dark:bg-surface-dark rounded-2xl shadow-sm border border-transparent hover:border-primary/20 transition-all";
        div.innerHTML = `
                <div class="flex shrink-0 items-center justify-center size-12 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                    <span class="material-symbols-outlined">${icon}</span>
                </div>
                <div class="flex-1 min-w-0 cursor-pointer" onclick="showHabitDetails(${habit.id})">
                    <h4 class="text-[#0d1b12] dark:text-white font-bold text-base truncate ${titleClass}">${habit.text}</h4>
                    <p class="text-xs text-gray-500 font-medium">${habit.frequency === 'daily' ? 'Täglich' : 'Flexibel'} ${progress ? '• ' + progress : ''}</p>
                </div>
                <button onclick="toggleHabit(${index})" class="shrink-0 size-8 rounded-full border-2 flex items-center justify-center transition-all active:scale-90 ${activeClass}">
                    <span class="material-symbols-outlined text-lg font-bold">check</span>
                </button>
            `;
        habitList.appendChild(div);
    });
}

// Render Tasks
const taskList = getEl('task-list');
if (taskList) {
    taskList.innerHTML = '';
    if (state.tasks) {
        state.tasks.forEach((task, index) => {
            const div = document.createElement('div');
            const isCompleted = task.completed;
            let tagHtml = '';
            if (task.tag) tagHtml = `<span class="ml-2 text-[10px] font-bold uppercase tracking-wider text-orange-500 border border-orange-500 px-1 rounded">${task.tag}</span>`;

            const checkboxClass = isCompleted
                ? 'bg-primary border-primary text-[#0d1b12]'
                : 'border-gray-300 dark:border-gray-600 hover:border-primary';

            div.className = `flex items-center gap-3 p-3 rounded-xl bg-surface-light dark:bg-surface-dark shadow-sm border-l-4 ${isCompleted ? 'border-primary' : 'border-gray-300 dark:border-gray-700'}`;

            div.innerHTML = `
                    <div class="flex-1">
                         <span class="text-sm font-bold text-[#0d1b12] dark:text-white ${isCompleted ? 'line-through opacity-50' : ''}">${task.text}</span>
                         ${tagHtml}
                    </div>
                    <button onclick="toggleTask(${index})" class="size-6 rounded border-2 flex items-center justify-center transition-all ${checkboxClass}">
                         <span class="material-symbols-outlined text-sm font-bold ${isCompleted ? '' : 'hidden'}">check</span>
                    </button>
                `;
            taskList.appendChild(div);
        });
    }
}

async function syncState(isPolling = false) {
    try {
        const res = await fetch('/api/state');
        if (res.ok) {
            const data = await res.json();
            const json = JSON.stringify(data);
            if (json === lastServerStateJson) return;
            lastServerStateJson = json;
            state = data;
            render();
            if (!isPolling) console.log("State synced");
        }
    } catch (e) {
        if (!isPolling) console.error("Sync failed", e);
    }
}

async function apiCallWithSync(endpoint, data) {
    pendingRequests++;
    try {
        const res = await fetch(`/api/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            await syncState();
            return true;
        }
    } catch (e) {
        console.error(e);
    } finally {
        pendingRequests--;
    }
    return false;
}

// --- Specific Habit Actions ---

async function toggleHabit(index) {
    const habit = state.habits[index];
    // Optimistic UI update 
    if (habit.completed) {
        habit.completed = false;
        habit.current = 0;
    } else {
        habit.current = (habit.current || 0) + 1;
        if (habit.current >= habit.target) {
            habit.current = habit.target;
            habit.completed = true;
        }
    }
    render();

    const success = await apiCallWithSync('toggle_habit', { id: habit.id });
    if (!success) {
        syncState();
    }
}

async function toggleTask(index) {
    const task = state.tasks[index];
    task.completed = !task.completed;
    render();
    const success = await apiCallWithSync('toggle_task', { id: task.id });
    if (!success) syncState();
}

// --- Modals & New Features ---

async function openAddHabitModal() {
    getEl('add-habit-modal').style.display = 'flex';
    // Reset fields
    getEl('new-habit-text').value = '';
    getEl('new-habit-target').value = 1;
    getEl('new-habit-freq').value = 'daily';
    toggleDaysInput();

    // Load friends for selector
    const container = getEl('friends-selector');
    container.innerHTML = '<p style="font-size: 0.8rem; color: var(--subtext-color);">Lade Freunde...</p>';
    try {
        const res = await fetch('/api/get_friends');
        const friends = await res.json();
        container.innerHTML = '';
        if (friends.length === 0) {
            container.innerHTML = '<p style="font-size: 0.8rem; color: var(--subtext-color);">Keine Freunde gefunden.</p>';
        } else {
            friends.forEach(f => {
                const div = document.createElement('div');
                div.style.padding = '0.3rem 0';
                div.innerHTML = `
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="checkbox" class="friend-checkbox" value="${f.id}">
                        <span>${f.username}</span>
                    </label>
                `;
                container.appendChild(div);
            });
        }
    } catch (e) {
        container.innerHTML = '<p style="color: var(--danger-color);">Fehler beim Laden.</p>';
    }
}

function toggleDaysInput() {
    const freq = getEl('new-habit-freq').value;
    const selector = getEl('days-selector');
    if (freq === 'specific') {
        selector.style.display = 'flex';
        selectedDays = [];
        document.querySelectorAll('.day-check').forEach(el => el.classList.remove('selected'));
    } else {
        selector.style.display = 'none';
        selectedDays = [];
    }
}

function toggleDay(dayIdx) {
    const el = getEl(`day-${dayIdx}`);
    if (selectedDays.includes(dayIdx)) {
        selectedDays = selectedDays.filter(d => d !== dayIdx);
        el.classList.remove('selected');
    } else {
        selectedDays.push(dayIdx);
        el.classList.add('selected');
    }
}

async function submitNewHabit() {
    const text = getEl('new-habit-text').value.trim();
    const target = parseInt(getEl('new-habit-target').value);
    const freq = getEl('new-habit-freq').value;

    if (!text) { alert('Bitte Namen eingeben.'); return; }
    if (freq === 'specific' && selectedDays.length === 0) {
        alert('Bitte mindestens einen Tag auswählen.'); return;
    }

    // Collect selected friends
    const friendIds = [];
    document.querySelectorAll('.friend-checkbox:checked').forEach(cb => {
        friendIds.push(parseInt(cb.value));
    });

    const payload = {
        text,
        target: target || 1,
        frequency: freq,
        days: selectedDays,
        friends: friendIds
    };

    const success = await apiCallWithSync('add_habit', payload);
    if (success) {
        getEl('add-habit-modal').style.display = 'none';
    } else {
        alert('Fehler beim Speichern.');
    }
}

async function submitNewTask() {
    const input = getEl('new-task-input');
    const sel = getEl('new-task-date');
    const text = input.value.trim();
    const offset = sel ? parseInt(sel.value) : 0;

    if (!text) return;

    input.value = ''; // clear immediately
    const success = await apiCallWithSync('add_task', { text, offset });
    if (!success) alert('Fehler');
}

function handleTaskKey(e) {
    if (e.key === 'Enter') submitNewTask();
}

async function showHabitDetails(id) {
    getEl('habit-details-modal').style.display = 'flex';
    try {
        const res = await fetch(`/habit/${id}`);
        if (res.ok) {
            const data = await res.json();
            getEl('detail-title').innerText = data.text;

            const currentHabit = state.habits.find(h => h.id === id);
            const current = currentHabit ? currentHabit.current : 0;
            const target = data.target;

            getEl('detail-stats').innerText = `${current} / ${target} (Aktuell)`;
            const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
            getEl('detail-progress').style.width = `${pct}%`;

            const histContainer = getEl('detail-history');
            histContainer.innerHTML = '';
            data.history.reverse().forEach(entry => {
                const bar = document.createElement('div');
                bar.style.flex = '1';
                bar.style.backgroundColor = entry.completed ? '#13ec5b' : 'rgba(255,255,255,0.1)';
                bar.style.borderRadius = '4px';
                bar.style.height = entry.completed ? '100%' : '20%';
                histContainer.appendChild(bar);
            });
        }
    } catch (e) { console.error(e); }
}

function closeDetails() {
    getEl('habit-details-modal').style.display = 'none';
}

// Global Bindings
window.toggleHabit = toggleHabit;
window.openAddHabitModal = openAddHabitModal;
window.toggleDaysInput = toggleDaysInput;
window.toggleDay = toggleDay;
window.submitNewHabit = submitNewHabit;
window.showHabitDetails = showHabitDetails;
window.closeDetails = closeDetails;
window.submitNewTask = submitNewTask;
window.handleTaskKey = handleTaskKey;
window.toggleTask = toggleTask;

// Modal Close logic
window.onclick = function (event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = "none";
    }
}
