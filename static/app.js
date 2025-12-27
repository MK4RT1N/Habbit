// State Management backed by API
let state = {
    habits: [],
    tasks: [],
    streak: 0
};
let lastServerStateJson = "";
let pendingRequests = 0;
let selectedDays = [];
let currentEntryType = 'habit'; // 'habit' or 'task'
let currentHabitFrequency = 'daily';
let currentHabitTargetValue = 1;
let currentDetailId = null;

// Selectors
const getEl = (id) => document.getElementById(id);

// Init
document.addEventListener('DOMContentLoaded', () => {
    if (typeof INITIAL_STATE !== 'undefined') {
        state = { ...INITIAL_STATE };
        lastServerStateJson = JSON.stringify(state);
        render();
    }

    syncState();

    setInterval(() => {
        if (pendingRequests === 0) {
            syncState(true);
        }
    }, 2000);

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
});

function render() {
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
    if (getEl('hero-circle-path')) {
        getEl('hero-circle-path').setAttribute('stroke-dasharray', `${pct}, 100`);
    }
    if (getEl('streak-display-hero')) getEl('streak-display-hero').innerText = `${state.streak} Tage 🔥`;

    // Render Habits
    const habitList = getEl('habit-list');
    if (habitList) {
        habitList.innerHTML = '';
        state.habits.forEach((habit, index) => {
            const div = document.createElement('div');
            const isCompleted = habit.completed;

            let icon = 'circle';
            let colorClass = 'bg-gray-100 dark:bg-gray-800 text-gray-500';
            const lowerText = habit.text.toLowerCase();

            if (lowerText.includes('run') || lowerText.includes('lauf')) {
                icon = 'directions_run'; colorClass = 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400';
            } else if (lowerText.includes('wat') || lowerText.includes('wass')) {
                icon = 'water_drop'; colorClass = 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400';
            } else if (lowerText.includes('read') || lowerText.includes('les')) {
                icon = 'menu_book'; colorClass = 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400';
            } else if (lowerText.includes('sleep') || lowerText.includes('schlaf')) {
                icon = 'bedtime'; colorClass = 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400';
            } else if (lowerText.includes('medit')) {
                icon = 'self_improvement'; colorClass = 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400';
            } else if (lowerText.includes('sport') || lowerText.includes('gym') || lowerText.includes('train')) {
                icon = 'fitness_center'; colorClass = 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400';
            } else if (lowerText.includes('essen') || lowerText.includes('eat') || lowerText.includes('kochen')) {
                icon = 'restaurant'; colorClass = 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400';
            }

            const checkClass = isCompleted
                ? 'bg-primary border-primary text-background-dark shadow-[0_0_10px_rgba(19,236,91,0.4)]'
                : 'border-2 border-gray-200 dark:border-gray-700 text-transparent hover:border-primary/50';

            const titleClass = isCompleted ? 'opacity-50 line-through decoration-2 decoration-primary/50' : 'text-[#0d1b12] dark:text-white';

            let progressHtml = `<p class="text-xs text-gray-500 font-medium">${habit.frequency === 'daily' ? 'Täglich' : (habit.frequency === 'specific' ? 'Tage' : 'Flexibel')}</p>`;
            if (habit.target > 1) {
                const progPct = Math.min((habit.current / habit.target) * 100, 100);
                progressHtml = `
                    <div class="flex items-center gap-2 mt-1">
                        <div class="h-1.5 flex-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden max-w-[100px]">
                            <div class="h-full bg-primary" style="width: ${progPct}%"></div>
                        </div>
                        <span class="text-[10px] text-gray-500 font-bold">${habit.current}/${habit.target}</span>
                    </div>
                `;
            }

            div.className = "group flex items-center gap-4 p-4 bg-white dark:bg-surface-dark rounded-2xl shadow-sm border border-transparent hover:border-primary/10 transition-all active:scale-[0.99]";
            div.innerHTML = `
                <div class="flex shrink-0 items-center justify-center size-12 rounded-2xl ${colorClass} transition-transform group-hover:scale-110">
                    <span class="material-symbols-outlined text-2xl font-medium">${icon}</span>
                </div>
                <div class="flex-1 min-w-0 cursor-pointer" onclick="showHabitDetails(${habit.id})">
                    <h4 class="font-bold text-base truncate ${titleClass}">${habit.text}</h4>
                    ${progressHtml}
                </div>
                <button onclick="toggleHabit(${index}); event.stopPropagation();" class="shrink-0 size-8 rounded-full border flex items-center justify-center transition-all active:scale-75 ${checkClass}">
                    <span class="material-symbols-outlined text-lg font-black">check</span>
                </button>
            `;
            habitList.appendChild(div);
        });
    }

    // Render Tasks
    const taskList = getEl('task-list');
    if (taskList) {
        taskList.innerHTML = '';
        state.tasks.forEach((task, index) => {
            const div = document.createElement('div');
            const isCompleted = task.completed;

            const checkClass = isCompleted
                ? 'bg-primary border-primary text-background-dark'
                : 'border-2 border-gray-200 dark:border-gray-700 text-transparent';

            const titleClass = isCompleted ? 'opacity-40 line-through' : 'text-[#0d1b12] dark:text-white';
            const tagHtml = task.tag ? `<span class="text-[10px] font-bold text-primary opacity-70">${task.tag}</span>` : '';

            div.className = "group flex items-center gap-4 p-4 bg-white dark:bg-surface-dark rounded-2xl shadow-sm transition-all";
            div.innerHTML = `
                <div class="flex shrink-0 items-center justify-center size-10 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-400">
                    <span class="material-symbols-outlined text-xl">assignment</span>
                </div>
                <div class="flex-1 min-w-0">
                    <h4 class="font-bold text-sm truncate ${titleClass}">${task.text}</h4>
                    ${tagHtml}
                </div>
                <button onclick="toggleTask(${task.id})" class="shrink-0 size-7 rounded-full border flex items-center justify-center transition-all ${checkClass}">
                    <span class="material-symbols-outlined text-base font-black">check</span>
                </button>
                <button onclick="deleteTask(${task.id}, event)" class="shrink-0 size-8 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-400 hover:bg-red-500/10 hover:text-red-500 flex items-center justify-center transition-colors ml-2 opacity-0 group-hover:opacity-100">
                    <span class="material-symbols-outlined text-sm">close</span>
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
            if (currentDetailId) refreshCurrentDetail();
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

// Actions
async function toggleHabit(index) {
    const habit = state.habits[index];
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
    if (!success) syncState();
}

async function toggleHabitFromDetail() {
    if (!currentDetailId) return;
    const idx = state.habits.findIndex(h => h.id === currentDetailId);
    if (idx !== -1) toggleHabit(idx);
}

async function toggleTask(index) {
    const task = state.tasks[index];
    task.completed = !task.completed;
    render();
    const success = await apiCallWithSync('toggle_task', { id: task.id });
    if (!success) syncState();
}

// ENTRY MODAL LOGIC
function openAddEntryModal(defaultType = 'habit') {
    const modal = getEl('add-entry-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    getEl('main-entry-input').value = '';
    getEl('main-entry-input').focus();

    currentHabitTargetValue = 1;
    updateTargetDisplay();

    selectedDays = [];
    document.querySelectorAll('.day-check-modal').forEach(el => el.classList.remove('selected'));

    populateTaskDatesModal();
    loadFriendsForModal();
    switchEntryType(defaultType);
}

function closeAddEntryModal() {
    getEl('add-entry-modal').classList.add('hidden');
}

function switchEntryType(type) {
    currentEntryType = type;
    const isHabit = type === 'habit';

    const habitTab = getEl('tab-habit');
    const taskTab = getEl('tab-task');
    const title = getEl('entry-title');
    const subtitle = getEl('entry-subtitle');
    const icon = getEl('entry-type-icon');
    const input = getEl('main-entry-input');
    const subBtnText = getEl('submit-btn-text');
    const subBtnIcon = getEl('submit-btn-icon');

    getEl('habit-freq-section').classList.toggle('hidden', !isHabit);
    getEl('habit-goal-section').classList.toggle('hidden', !isHabit);
    getEl('task-date-section').classList.toggle('hidden', isHabit);

    const active = "bg-surface-dark shadow-sm text-white font-bold";
    const inactive = "text-gray-400 font-semibold";

    if (isHabit) {
        habitTab.className = `flex-1 py-1.5 px-3 rounded-lg text-xs transition-all ${active}`;
        taskTab.className = `flex-1 py-1.5 px-3 rounded-lg text-xs transition-all ${inactive}`;
        title.innerText = "Neue Gewohnheit";
        subtitle.innerText = "Beständigkeit ist der Schlüssel zum Erfolg.";
        icon.innerText = "sentiment_satisfied";
        input.placeholder = "z.B. 10 Seiten lesen";
        subBtnText.innerText = "Gewohnheit erstellen";
        subBtnIcon.innerText = "add_circle";
    } else {
        taskTab.className = `flex-1 py-1.5 px-3 rounded-lg text-xs transition-all ${active}`;
        habitTab.className = `flex-1 py-1.5 px-3 rounded-lg text-xs transition-all ${inactive}`;
        title.innerText = "Neue Aufgabe";
        subtitle.innerText = "Erledige die Dinge nacheinander.";
        icon.innerText = "assignment";
        input.placeholder = "z.B. Lebensmittel einkaufen";
        subBtnText.innerText = "Aufgabe hinzufügen";
        subBtnIcon.innerText = "task_alt";
    }
}

function setFrequency(freq) {
    currentHabitFrequency = freq;
    document.querySelectorAll('.freq-btn').forEach(b => b.classList.remove('active'));

    if (freq === 'daily') getEl('freq-daily').classList.add('active');
    if (freq === 'specific') getEl('freq-specific').classList.add('active');
    if (freq === 'weekly_flex') getEl('freq-weekly').classList.add('active');

    getEl('days-selector-modal').classList.toggle('hidden', freq !== 'specific');
}

function toggleDayModal(idx) {
    const el = getEl(`modal-day-${idx}`);
    if (selectedDays.includes(idx)) {
        selectedDays = selectedDays.filter(d => d !== idx);
        el.classList.remove('selected');
    } else {
        selectedDays.push(idx);
        el.classList.add('selected');
    }
}

function adjustTarget(amt) {
    currentHabitTargetValue = Math.max(1, currentHabitTargetValue + amt);
    updateTargetDisplay();
}

function updateTargetDisplay() {
    getEl('target-display').innerText = currentHabitTargetValue;
}

function populateTaskDatesModal() {
    const sel = getEl('new-task-date-modal');
    if (!sel) return;
    sel.innerHTML = '';
    const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        let label = i === 0 ? "Heute" : (i === 1 ? "Morgen" : days[d.getDay()] + ` ${d.getDate()}.${d.getMonth() + 1}.`);
        const opt = document.createElement('option');
        opt.value = i;
        opt.innerText = label;
        sel.appendChild(opt);
    }
}

async function loadFriendsForModal() {
    const container = getEl('friends-selector-modal');
    if (!container) return;
    container.innerHTML = '<p class="text-xs text-gray-500">Lade Freunde...</p>';
    try {
        const res = await fetch('/api/get_friends');
        const friends = await res.json();
        container.innerHTML = '';
        if (friends.length === 0) {
            container.innerHTML = '<p class="text-xs text-gray-500">Keine Freunde gefunden.</p>';
        } else {
            friends.forEach(f => {
                const div = document.createElement('div');
                div.className = "flex items-center justify-between p-2 bg-black/20 rounded-xl";
                div.innerHTML = `
                    <span class="text-sm font-bold text-white">${f.username}</span>
                    <input type="checkbox" class="friend-checkbox-modal size-5 accent-primary" value="${f.id}">
                `;
                container.appendChild(div);
            });
        }
    } catch (e) { container.innerHTML = '<p class="text-xs text-red-500">Fehler beim Laden.</p>'; }
}

async function submitEntry() {
    const text = getEl('main-entry-input').value.trim();
    if (!text) { alert('Bitte Text eingeben.'); return; }

    if (currentEntryType === 'habit') {
        const friendIds = [];
        document.querySelectorAll('.friend-checkbox-modal:checked').forEach(cb => friendIds.push(parseInt(cb.value)));

        const payload = {
            text,
            target: currentHabitTargetValue,
            frequency: currentHabitFrequency,
            days: selectedDays,
            friends: friendIds
        };
        const success = await apiCallWithSync('add_habit', payload);
        if (success) closeAddEntryModal();
    } else {
        const offset = parseInt(getEl('new-task-date-modal').value);
        const success = await apiCallWithSync('add_task', { text, offset });
        if (success) closeAddEntryModal();
    }
}

// PREMIUM DETAILS POPULATION
async function showHabitDetails(id) {
    currentDetailId = id;
    const modal = getEl('habit-details-modal');
    modal.classList.remove('hidden');

    // Emoji heuristic
    const lowerText = state.habits.find(h => h.id === id)?.text.toLowerCase() || "";
    let emoji = "✨";
    if (lowerText.includes('run') || lowerText.includes('lauf')) emoji = "🏃";
    else if (lowerText.includes('wat') || lowerText.includes('wass')) emoji = "💧";
    else if (lowerText.includes('read') || lowerText.includes('les')) emoji = "📚";
    else if (lowerText.includes('sleep') || lowerText.includes('schlaf')) emoji = "🌙";
    else if (lowerText.includes('medit')) emoji = "🧘";
    getEl('detail-icon-emoji').innerText = emoji;

    try {
        const res = await fetch(`/habit/${id}`);
        if (res.ok) {
            const data = await res.json();
            getEl('detail-title').innerText = data.text;
            getEl('detail-subtitle').innerText = `${data.frequency === 'daily' ? 'Täglich' : 'Flexibel'}: ${data.target} ${data.target > 1 ? 'Einheiten' : 'Mal'}`;

            getEl('detail-streak-val').innerText = data.current_streak;
            getEl('stat-best-streak').innerText = data.best_streak;
            getEl('stat-total').innerText = data.total_done;
            getEl('stat-rate').innerText = data.completion_rate + "%";

            getEl('detail-status-text').innerText = data.current_streak > 0 ? "Du bist on fire! 🔥" : "Laufschuhe an! 💪";

            // Calendar
            const grid = getEl('detail-calendar-grid');
            grid.innerHTML = '';
            // History is last 30 days
            data.history.slice().reverse().forEach(day => {
                const dayEl = document.createElement('div');
                dayEl.className = "aspect-square flex items-center justify-center text-[10px] font-bold rounded-lg transition-all";
                if (day.completed) {
                    dayEl.className += " bg-primary text-background-dark shadow-[0_0_8px_rgba(19,236,91,0.4)]";
                } else if (day.partial) {
                    dayEl.className += " bg-primary/20 text-primary";
                } else {
                    dayEl.className += " border border-dashed border-gray-700 text-gray-600";
                }
                dayEl.innerText = day.day;
                grid.appendChild(dayEl);
            });

            // Activity
            const activity = getEl('recent-activity-list');
            activity.innerHTML = '';
            data.recent.forEach(act => {
                const item = document.createElement('div');
                item.className = "bg-surface-dark p-4 rounded-2xl border border-gray-800 flex items-center justify-between";
                item.innerHTML = `
                    <div class="flex items-center gap-4">
                        <div class="size-10 rounded-xl ${act.completed ? 'bg-primary/20 text-primary' : 'bg-gray-800 text-gray-500'} flex items-center justify-center">
                            <span class="material-symbols-outlined text-xl">${act.completed ? 'check_circle' : 'remove_circle_outline'}</span>
                        </div>
                        <div>
                            <p class="text-sm font-bold text-white">${act.display_date}</p>
                            <p class="text-xs text-gray-500 font-medium">${act.completed ? 'Abgeschlossen' : 'Offen / Übersprungen'}</p>
                        </div>
                    </div>
                    <span class="text-[10px] font-bold uppercase tracking-widest ${act.completed ? 'text-primary' : 'text-gray-600'}">${act.completed ? 'DONE' : 'MISS'}</span>
                `;
                activity.appendChild(item);
            });
        }
    } catch (e) { }
}

function refreshCurrentDetail() {
    if (currentDetailId) showHabitDetails(currentDetailId);
}

function closeDetails() {
    currentDetailId = null;
    getEl('habit-details-modal').classList.add('hidden');
}



async function deleteCurrentHabit() {
    if (!currentDetailId) return;
    if (!confirm('Möchtest du diese Gewohnheit wirklich löschen?')) return;

    try {
        const res = await fetch('/api/delete_habit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: currentDetailId })
        });
        const data = await res.json();
        if (data.success) {
            closeDetails();
            syncState(true);
        } else {
            alert('Fehler beim Löschen.');
        }
    } catch (e) {
        console.error(e);
    }
}

async function deleteTask(id, event) {
    if (event) event.stopPropagation();
    if (!confirm('Aufgabe entfernen?')) return;

    try {
        const res = await fetch('/api/delete_task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (data.success) {
            syncState(true);
        }
    } catch (e) { console.error(e); }
}

// Global Bindings
window.toggleHabit = toggleHabit;
window.toggleTask = toggleTask;
window.openAddEntryModal = openAddEntryModal;
window.closeAddEntryModal = closeAddEntryModal;
window.switchEntryType = switchEntryType;
window.setFrequency = setFrequency;
window.toggleDayModal = toggleDayModal;
window.adjustTarget = adjustTarget;
window.submitEntry = submitEntry;
window.showHabitDetails = showHabitDetails;
window.closeDetails = closeDetails;
window.toggleHabitFromDetail = toggleHabitFromDetail;
window.toggleHabitFromDetail = toggleHabitFromDetail;
window.deleteCurrentHabit = deleteCurrentHabit;
window.deleteTask = deleteTask;
