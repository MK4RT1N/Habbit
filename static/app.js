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
});

function render() {
    const streakCount = getEl('streak-count');
    const habitList = getEl('habit-list');

    if (streakCount) streakCount.innerText = state.streak;

    if (habitList) {
        habitList.innerHTML = '';
        state.habits.forEach((habit, index) => {
            const div = document.createElement('div');
            const isCompleted = habit.completed;
            const progressText = habit.target > 1 ? `(${habit.current}/${habit.target})` : '';

            let extraInfo = '';
            if (habit.shared) extraInfo += ' <span style="color: var(--secondary-color); font-size: 0.8rem;">👥</span>';
            // if(habit.shared_info) extraInfo += ` <span style="font-size: 0.7rem;">${habit.shared_info}</span>`;

            div.className = `habit-item ${isCompleted ? 'completed' : ''}`;
            div.innerHTML = `
                <div class="habit-content" style="cursor: pointer; flex-grow: 1;" onclick="showHabitDetails(${habit.id})">
                     <span class="habit-text">${habit.text} <small style="opacity: 0.6; font-size: 0.8rem;">${progressText}</small>${extraInfo}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="checkbox" onclick="toggleHabit(${index})">
                         <span class="check-icon" style="${isCompleted ? 'opacity: 1; transform: scale(1);' : ''}">${isCompleted ? '✓' : ''}</span>
                    </div>
                </div>
            `;
            habitList.appendChild(div);
        });
    }

    const taskList = getEl('task-list');
    if (taskList) {
        taskList.innerHTML = '';
        if (state.tasks) {
            state.tasks.forEach((task, index) => {
                const div = document.createElement('div');
                const isCompleted = task.completed;
                let tagHtml = '';
                if (task.tag) tagHtml = `<span style="font-size: 0.7rem; color: #ff9800; border: 1px solid #ff9800; padding: 2px 4px; border-radius: 4px; margin-left: 5px;">${task.tag}</span>`;

                div.className = `habit-item ${isCompleted ? 'completed' : ''}`;
                div.style.borderLeft = isCompleted ? '4px solid var(--success-color)' : '4px solid var(--secondary-color)';

                div.innerHTML = `
                    <div class="habit-content" style="flex-grow: 1;">
                         <span class="habit-text">${task.text} ${tagHtml}</span>
                    </div>
                    <div class="checkbox" onclick="toggleTask(${index})">
                         <span class="check-icon" style="${isCompleted ? 'opacity: 1; transform: scale(1);' : ''}">${isCompleted ? '✓' : ''}</span>
                    </div>
                `;
                taskList.appendChild(div);
            });
        }
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
    const text = input.value.trim();
    if (!text) return;

    input.value = ''; // clear immediately
    const success = await apiCallWithSync('add_task', { text });
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
                bar.style.background = entry.completed ? 'var(--primary-color)' : 'rgba(255,255,255,0.1)';
                bar.style.borderRadius = '4px';
                bar.title = `${entry.date}: ${entry.value}`;
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
