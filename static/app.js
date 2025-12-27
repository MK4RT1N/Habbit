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
                ? 'bg-primary border-primary text-background-dark shadow-[0_0_15px_rgba(19,236,91,0.4)]'
                : 'border-2 border-white/5 text-transparent hover:border-primary/50';

            const titleClass = isCompleted ? 'opacity-40 line-through decoration-2 decoration-primary/50' : 'text-white';

            let progressHtml = `<p class="text-xs text-white/40 font-bold uppercase tracking-wider">${habit.frequency === 'daily' ? 'Täglich' : (habit.frequency === 'specific' ? 'Spezifisch' : 'Flexibel')}</p>`;
            if (habit.target > 1) {
                const progPct = Math.min((habit.current / habit.target) * 100, 100);
                progressHtml = `
                    <div class="flex items-center gap-3 mt-1.5">
                        <div class="h-1 flex-1 bg-white/5 rounded-full overflow-hidden max-w-[120px]">
                            <div class="h-full bg-primary shadow-[0_0_8px_rgba(19,236,91,0.4)]" style="width: ${progPct}%"></div>
                        </div>
                        <span class="text-[10px] text-white/40 font-black tracking-widest">${habit.current}/${habit.target}</span>
                    </div>
                `;
            }

            div.className = "group flex items-center gap-5 p-5 bg-[#1a2e22] rounded-[2rem] border border-white/5 transition-all active:scale-[0.98]";
            div.innerHTML = `
                <div class="flex shrink-0 items-center justify-center size-14 rounded-2xl ${colorClass.includes('dark:bg-') ? colorClass.split(' ').filter(c => c.startsWith('dark:') || c.startsWith('text-')).map(c => c.replace('dark:', '')).join(' ') : colorClass} transition-transform group-hover:scale-105">
                    <span class="material-symbols-outlined text-2xl font-medium">${icon}</span>
                </div>
                <div class="flex-1 min-w-0 cursor-pointer" onclick="showHabitDetails(${habit.id})">
                    <h4 class="font-black text-base truncate mb-0.5 ${titleClass}">${habit.text}</h4>
                    ${progressHtml}
                </div>
                <button onclick="toggleHabit(${index}); event.stopPropagation();" class="shrink-0 size-9 rounded-full border flex items-center justify-center transition-all active:scale-75 ${checkClass}">
                    <span class="material-symbols-outlined text-xl font-black">${isCompleted ? 'check' : ''}</span>
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
                ? 'bg-primary border-primary text-background-dark shadow-[0_0_10px_rgba(19,236,91,0.3)]'
                : 'border-2 border-white/5 text-transparent';

            const titleClass = isCompleted ? 'opacity-30 line-through' : 'text-white';
            const tagHtml = task.tag ? `<span class="text-[10px] font-black text-primary opacity-60 uppercase tracking-widest">${task.tag}</span>` : '';

            div.className = "group flex items-center gap-5 p-5 bg-[#1a2e22] rounded-[2rem] border border-white/5 transition-all active:scale-[0.98]";
            div.innerHTML = `
                <div class="flex shrink-0 items-center justify-center size-12 rounded-2xl bg-white/5 text-white/30">
                    <span class="material-symbols-outlined text-2xl">assignment</span>
                </div>
                <div class="flex-1 min-w-0 cursor-pointer" onclick="showTaskDetails(${task.id})">
                    <h4 class="font-black text-base truncate mb-0.5 ${titleClass}">${task.text}</h4>
                    ${tagHtml}
                </div>
                <button onclick="toggleTask(${index}); event.stopPropagation();" class="shrink-0 size-9 rounded-full border flex items-center justify-center transition-all ${checkClass}">
                    <span class="material-symbols-outlined text-xl font-black">${isCompleted ? 'check' : ''}</span>
                </button>
                <button onclick="deleteTask(${task.id}, event)" class="shrink-0 size-10 rounded-2xl bg-white/5 text-white/20 hover:bg-red-500/10 hover:text-red-500 flex items-center justify-center transition-all ml-2 opacity-0 group-hover:opacity-100">
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

    const active = "bg-surface-dark shadow-md text-white font-black";
    const inactive = "text-white/20 font-black";

    if (isHabit) {
        habitTab.className = `flex-1 py-3 rounded-xl text-[10px] uppercase tracking-widest transition-all ${active}`;
        taskTab.className = `flex-1 py-3 rounded-xl text-[10px] uppercase tracking-widest transition-all ${inactive}`;
        title.innerText = "Neue Gewohnheit";
        subtitle.innerText = "Beständigkeit ist der Schlüssel zum Erfolg.";
        icon.innerText = "sentiment_satisfied";
        input.placeholder = "z.B. 10 Seiten lesen";
        subBtnText.innerText = "Gewohnheit erstellen";
        subBtnIcon.innerText = "add_circle";
    } else {
        taskTab.className = `flex-1 py-3 rounded-xl text-[10px] uppercase tracking-widest transition-all ${active}`;
        habitTab.className = `flex-1 py-3 rounded-xl text-[10px] uppercase tracking-widest transition-all ${inactive}`;
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

            // Subtitle frequency
            const freqUpper = data.frequency === 'daily' ? 'TÄGLICH' :
                (data.frequency === 'specific' ? 'FESTE TAGE' : 'FLEXIBEL');
            getEl('detail-subtitle').innerText = `${freqUpper}: ${data.target} ${data.target > 1 ? 'MAL' : 'MAL'}`;

            getEl('detail-streak-val').innerText = data.current_streak;
            getEl('stat-best-streak').innerText = data.best_streak;
            getEl('stat-total').innerText = data.total_done;
            getEl('stat-rate').innerText = data.completion_rate + "%";

            getEl('detail-status-text').innerText = data.current_streak > 0 ? "Du bist on fire! 🔥" : "Laufschuhe an! 💪";

            // Calendar
            const grid = getEl('detail-calendar-grid');
            grid.innerHTML = '';
            // History is last 28 days for clean grid or slice
            data.history.slice(-28).forEach(day => {
                const dayEl = document.createElement('div');
                dayEl.className = "aspect-square flex items-center justify-center text-[10px] font-black rounded-xl transition-all border";
                if (day.completed) {
                    dayEl.className += " bg-primary border-primary text-background-dark shadow-[0_5px_15px_rgba(19,236,91,0.3)]";
                } else if (day.partial) {
                    dayEl.className += " bg-primary/20 border-primary/20 text-primary";
                } else {
                    dayEl.className += " border-white/5 bg-white/[0.02] text-white/20 border-dashed";
                }
                dayEl.innerText = day.day;
                grid.appendChild(dayEl);
            });

            // Activity
            const activity = getEl('recent-activity-list');
            activity.innerHTML = '';
            data.recent.forEach(act => {
                const item = document.createElement('div');
                item.className = "group flex items-center justify-between p-5 bg-white/5 rounded-[2rem] border border-white/5 transition-all hover:bg-white/[0.08]";
                item.innerHTML = `
                    <div class="flex items-center gap-5">
                        <div class="size-12 rounded-2xl ${act.completed ? 'bg-primary/10 text-primary' : 'bg-white/5 text-white/10'} flex items-center justify-center">
                            <span class="material-symbols-outlined text-2xl font-medium">${act.completed ? 'check_circle' : 'remove_circle_outline'}</span>
                        </div>
                        <div>
                            <p class="text-sm font-black text-white mb-0.5">${act.display_date}</p>
                            <p class="text-[10px] text-white/30 font-bold uppercase tracking-widest">${act.completed ? 'Abgeschlossen' : 'Offen / Übersprungen'}</p>
                        </div>
                    </div>
                    <span class="text-[10px] font-black uppercase tracking-widest ${act.completed ? 'text-primary' : 'text-white/20'}">${act.completed ? 'DONE' : 'MISS'}</span>
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

// TASK DETAILS LOGIC
let currentTaskDetailId = null;

function showTaskDetails(id) {
    currentTaskDetailId = id;
    const modal = getEl('task-details-modal');
    modal.classList.remove('hidden');

    const task = state.tasks.find(t => t.id === id);
    if (task) {
        getEl('task-detail-title').innerText = task.text;
        // Simple date logic for MVP (assuming today/future labels)
        getEl('task-detail-date').innerText = "Aufgabe";

        const btnText = getEl('task-detail-btn-text');
        const btn = getEl('task-detail-action-btn');
        if (task.completed) {
            btnText.innerText = "Als offen markieren";
            btn.classList.add('bg-surface-dark', 'text-gray-500', 'border-gray-700');
            btn.classList.remove('bg-surface-dark', 'text-blue-500', 'border-blue-500/30');
            // Reset styles a bit for toggle
        } else {
            btnText.innerText = "Als erledigt markieren";
            btn.classList.remove('text-gray-500', 'border-gray-700');
            btn.classList.add('text-blue-500', 'border-blue-500/30');
        }
    }
}

function closeTaskDetails() {
    currentTaskDetailId = null;
    getEl('task-details-modal').classList.add('hidden');
}

async function deleteCurrentTask() {
    if (!currentTaskDetailId) return;
    if (!confirm('Aufgabe wirklich löschen?')) return;
    try {
        const res = await fetch('/api/delete_task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: currentTaskDetailId })
        });
        const data = await res.json();
        if (data.success) {
            closeTaskDetails();
            syncState(true);
        }
    } catch (e) { console.error(e); }
}

async function toggleTaskFromDetail() {
    if (!currentTaskDetailId) return;
    const idx = state.tasks.findIndex(t => t.id === currentTaskDetailId);
    if (idx !== -1) {
        await toggleTask(idx);
        showTaskDetails(currentTaskDetailId); // Refresh UI
    }
}



// INVITE LOGIC
async function showInviteModal() {
    const friendsRes = await fetch('/api/get_friends');
    const friends = await friendsRes.json();

    if (friends.length === 0) {
        alert("Du hast noch keine Freunde hinzugefügt!");
        return;
    }

    let msg = "Wähle einen Freund (Nummer eingeben):\n";
    friends.forEach((f, i) => {
        msg += `${i + 1}: ${f.username}\n`;
    });

    const choice = prompt(msg);
    if (choice) {
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < friends.length) {
            await inviteFriendToHabit(friends[idx].id);
        } else {
            alert("Ungültige Auswahl");
        }
    }
}

async function inviteFriendToHabit(friendId) {
    if (!currentDetailId) return;
    try {
        const res = await fetch('/api/invite_to_habit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                habit_id: currentDetailId,
                friend_id: friendId
            })
        });
        const data = await res.json();
        if (data.success) {
            alert("Einladung gesendet! (Habit wurde beim Freund erstellt)");
            showHabitDetails(currentDetailId);
        } else {
            alert("Fehler beim Einladen.");
        }
    } catch (e) { console.error(e); }
}

window.toggleHabitFromDetail = toggleHabitFromDetail;
window.deleteCurrentHabit = deleteCurrentHabit;
window.deleteTask = deleteTask;
window.showTaskDetails = showTaskDetails;
window.closeTaskDetails = closeTaskDetails;
window.deleteCurrentTask = deleteCurrentTask;
window.toggleTaskFromDetail = toggleTaskFromDetail;
window.showInviteModal = showInviteModal;
window.showInviteModal = showInviteModal;
