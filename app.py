from flask import Flask, render_template, send_from_directory, request, redirect, url_for, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date, timedelta
import logging
import uuid
import json
import os

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dev-secret-key-change-this'

# Check for Docker environment variable, else use local path
db_path = os.environ.get('SQLALCHEMY_DATABASE_URI', 'sqlite:///habitflow_v3.db')
app.config['SQLALCHEMY_DATABASE_URI'] = db_path
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# --- Models ---
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(150), nullable=False)
    habits = db.relationship('Habit', backref='user', lazy=True)
    current_streak = db.Column(db.Integer, default=0)
    last_completed_date = db.Column(db.Date, nullable=True)

class Friendship(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    status = db.Column(db.String(20), default='pending') # pending, accepted

class Habit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.String(200), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    
    # Frequency Config
    frequency = db.Column(db.String(20), default='daily') # daily, specific, weekly_flex
    days = db.Column(db.String(50), default='0,1,2,3,4,5,6') 
    target = db.Column(db.Integer, default=1) 
    
    # Sharing
    is_shared = db.Column(db.Boolean, default=False)
    shared_id = db.Column(db.String(36), nullable=True) # UUID to group users contexts
    shared_streak = db.Column(db.Integer, default=0) # Calculated group streak
    
    logs = db.relationship('HabitLog', backref='habit', lazy=True, cascade="all, delete-orphan")

class HabitLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    habit_id = db.Column(db.Integer, db.ForeignKey('habit.id'), nullable=False)
    date = db.Column(db.Date, default=date.today)
    value = db.Column(db.Integer, default=0) 
    completed = db.Column(db.Boolean, default=False)

class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.String(200), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_date = db.Column(db.Date, default=date.today)
    scheduled_date = db.Column(db.Date, default=date.today)
    completed = db.Column(db.Boolean, default=False)
    completed_date = db.Column(db.Date, nullable=True)

class Achievement(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(50), unique=True, nullable=False)
    title = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(255), nullable=False)
    icon = db.Column(db.String(50), default='emoji_events')
    condition_type = db.Column(db.String(50), nullable=False) # 'streak', 'habits_created', 'habits_completed', 'tasks_completed'
    threshold = db.Column(db.Integer, nullable=False)

class UserAchievement(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    achievement_id = db.Column(db.Integer, db.ForeignKey('achievement.id'), nullable=False)
    date_earned = db.Column(db.Date, default=date.today)



@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- Helpers ---
def get_start_of_week(d):
    return d - timedelta(days=d.weekday())

def compute_user_state(user):
    today = date.today()
    weekday = str(today.weekday())
    habits = Habit.query.filter_by(user_id=user.id).all()
    habit_data = []

    for h in habits:
        # Visibility Check
        is_visible = False
        if h.frequency == 'daily': is_visible = True
        elif h.frequency == 'specific' and weekday in h.days.split(','): is_visible = True
        elif h.frequency == 'weekly_flex': is_visible = True
        
        if not is_visible: continue

        # Completion Logic
        completed = False
        current_val = 0
        
        if h.frequency == 'weekly_flex':
            start_week = get_start_of_week(today)
            logs = HabitLog.query.filter(HabitLog.habit_id==h.id, HabitLog.date >= start_week).all()
            total_val = sum(l.value for l in logs)
            current_val = total_val
            if current_val >= h.target:
                completed = True
        else:
            log = HabitLog.query.filter_by(habit_id=h.id, date=today).first()
            if log:
                current_val = log.value
                completed = log.completed

        # Group Info
        shared_info = ""
        if h.is_shared:
             shared_info = "(Gruppe)"

        habit_data.append({
            'id': h.id, 
            'text': h.text, 
            'completed': completed,
            'current': current_val,
            'target': h.target,
            'shared': h.is_shared,
            'shared_info': shared_info
        })
        
    # --- Task Logic ---
    tasks_query = Task.query.filter_by(user_id=user.id).all()
    task_data = []
    
    for t in tasks_query:
        # Expiration Logic
        # 1. If completed, show ONLY if completed_date == today (delete at midnight logic)
        if t.completed:
            if t.completed_date != today:
                continue # Hide (effectively deleted from view, generic cleanup can handle DB later)
        
        # 2. If NOT completed:
        #    - Show if scheduled_date == today
        #    - Show if scheduled_date < today AND created_date >= today - 3 days (Overdue logic)
        #    - Hide if scheduled_date > today
        
        s_date = t.scheduled_date if t.scheduled_date else t.created_date

        if not t.completed:
            if s_date > today: 
                continue # Future task
            
            # If overdue, check if it's too old (3 days from scheduled date)
            delta = (today - s_date).days
            if delta > 3:
                continue # Expired/Delete
        
        # Determine label (e.g. "Yesterday")
        tag = ""
        days_diff = (today - s_date).days
        if not t.completed:
            if days_diff == 1: tag = "Gestern"
            elif days_diff > 1: tag = f"Vor {days_diff} Tagen"
            elif days_diff == 0: tag = "Heute"
            # Note: Future tasks are filtered out above, but if we wanted to show them later, we could add logic here.
        
        task_data.append({
            'id': t.id,
            'text': t.text,
            'completed': t.completed,
            'tag': tag
        })
    
    # Sort tasks: Uncompleted first, then by date desc
    task_data.sort(key=lambda x: (x['completed'], x['id']))

    return {
        'habits': habit_data,
        'tasks': task_data,
        'streak': user.current_streak
    }

def check_group_streak_logic(shared_id):
    pass 

@app.context_processor
def inject_calendar():
    today = date.today()
    # Get start of current week (Monday)
    start = today - timedelta(days=today.weekday())
    week_dates = []
    days_de = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    for i in range(7):
        d = start + timedelta(days=i)
        week_dates.append({
            'day_name': days_de[i],
            'day_num': d.day,
            'is_today': d == today,
            'date_str': d.strftime('%Y-%m-%d')
        })
    return {'week_calendar': week_dates}

@app.context_processor
def inject_version():
    try:
        with open('version.txt', 'r') as f:
            version = f.read().strip()
    except:
        version = '1.0.0'
    return {'version': version}

# --- Routes ---

@app.route('/')
@login_required
def index():
    data = compute_user_state(current_user)
    return render_template('index.html', user=current_user, habits=data['habits'], tasks=data['tasks'], streak=data['streak'])

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        if user and check_password_hash(user.password, password):
            login_user(user)
            return redirect(url_for('index'))
        flash('Login fehlgeschlagen.')
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if User.query.filter_by(username=username).first():
            flash('Username vergeben.')
        else:
            hashed = generate_password_hash(password, method='pbkdf2:sha256')
            new_user = User(username=username, password=hashed)
            db.session.add(new_user)
            db.session.commit()
            login_user(new_user)
            return redirect(url_for('index'))
    return render_template('register.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/manage')
@login_required
def manage():
    habits = Habit.query.filter_by(user_id=current_user.id).all()
    return render_template('manage.html', habits=habits)

@app.route('/friends')
@login_required
def friends_page():
    return render_template('friends.html')

@app.route('/achievements')
@login_required
def achievements_page():
    check_new_achievements(current_user) # Check explicitly when visiting
    all_achievements = Achievement.query.all()
    user_achievements = UserAchievement.query.filter_by(user_id=current_user.id).all()
    earned_ids = {ua.achievement_id for ua in user_achievements}
    
    # Prepare data for template
    display_data = []
    for ach in all_achievements:
        display_data.append({
            'title': ach.title,
            'description': ach.description,
            'icon': ach.icon,
            'earned': ach.id in earned_ids,
            'date': next((ua.date_earned for ua in user_achievements if ua.achievement_id == ach.id), None)
        })
    
    return render_template('achievements.html', achievements=display_data)



# --- API ---

@app.route('/api/state')
@login_required
def get_state():
    return jsonify(compute_user_state(current_user))

@app.route('/api/add_habit', methods=['POST'])
@login_required
def add_habit():
    try:
        data = request.json
        text = data.get('text')
        target = int(data.get('target', 1))
        frequency = data.get('frequency', 'daily')
        days = data.get('days', [])
        friend_ids = data.get('friends', []) # List of user IDs to share with
        
        if frequency == 'specific':
            days_str = ",".join(map(str, days))
        else:
            days_str = "0,1,2,3,4,5,6" # Default

        shared_id = None
        is_shared = len(friend_ids) > 0
        if is_shared:
            shared_id = str(uuid.uuid4())
            
        # Create for self
        me_habit = Habit(text=text, user_id=current_user.id, target=target, frequency=frequency, days=days_str, is_shared=is_shared, shared_id=shared_id)
        db.session.add(me_habit)
        
        # Create for friends
        for fid in friend_ids:
            # Verify friendship exists? Skipped for MVP speed, assuming UI provides valid IDs
            f_habit = Habit(text=text, user_id=fid, target=target, frequency=frequency, days=days_str, is_shared=True, shared_id=shared_id)
            db.session.add(f_habit)
            
        db.session.commit()
        check_new_achievements(current_user)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Add habit error: {e}")
        return jsonify({'success': False})

@app.route('/api/add_task', methods=['POST'])
@login_required
def add_task():
    try:
        data = request.json
        text = data.get('text')
        date_offset = int(data.get('offset', 0)) # 0 = today, 1 = tomorrow ...
        
        if not text: return jsonify({'success': False})
        
        s_date = date.today() + timedelta(days=date_offset)
        
        t = Task(text=text, user_id=current_user.id, scheduled_date=s_date)
        db.session.add(t)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Task error: {e}")
        return jsonify({'success': False})

@app.route('/api/toggle_habit', methods=['POST'])
@login_required
def toggle_habit():
    try:
        data = request.json
        habit_id = data.get('id')
        habit = Habit.query.get(habit_id)
        if habit.user_id != current_user.id: return jsonify({'success': False})
        
        today = date.today()
        
        if habit.frequency == 'weekly_flex':
             # Logic for weekly: Just add a log for today with +1 value
             log = HabitLog.query.filter_by(habit_id=habit.id, date=today).first()
             if not log:
                 log = HabitLog(habit_id=habit.id, date=today, value=0)
                 db.session.add(log)
             
             # Check total for week
             start_week = get_start_of_week(today)
             logs_week = HabitLog.query.filter(HabitLog.habit_id==habit.id, HabitLog.date >= start_week).all()
             total = sum(l.value for l in logs_week)
             
             # If strictly toggling:
             # Complex logic: If we assume UI sends "do it", we increment.
             # If user spams click, we assume they want to add reps.
             # But if completed, maybe we don't toggle off for weekly?
             # Let's keep simple: Increment
             log.value += 1
             # Recalc total
             if (total + 1) >= habit.target:
                 # Mark all logs this week as completed? Or just conceptual?
                 pass 
        else:
            log = HabitLog.query.filter_by(habit_id=habit.id, date=today).first()
            if not log:
                log = HabitLog(habit_id=habit.id, date=today, value=0, completed=False)
                db.session.add(log)
            
            if log.completed:
                log.completed = False
                log.value = 0
            else:
                log.value += 1
                if log.value >= habit.target:
                    log.value = habit.target
                    log.completed = True

        db.session.commit()
        check_global_streak(current_user)
        check_new_achievements(current_user)
        if habit.is_shared:
            check_group_streak(habit.shared_id)
            
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Add habit error: {e}")
        return jsonify({'success': False})

@app.route('/habit/<int:id>')
@login_required
def get_habit_details(id):
    habit = Habit.query.get_or_404(id)
    if habit.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    # Get all logs for this habit sorted by date
    logs = HabitLog.query.filter_by(habit_id=id).order_by(HabitLog.date.desc()).all()
    
    # Calculate Streaks
    current_streak = 0
    best_streak = 0
    temp_streak = 0
    
    today = date.today()
    # For calculation, we need ascending order
    asc_logs = HabitLog.query.filter_by(habit_id=id).order_by(HabitLog.date.asc()).all()
    
    # Simple streak calculation (daily/specific)
    # Note: A real streak calc would check if days were missed.
    # For MVP: consecutive days with completed=True
    last_date = None
    for l in asc_logs:
        if l.completed:
            if last_date and (l.date - last_date).days == 1:
                temp_streak += 1
            else:
                temp_streak = 1
            best_streak = max(best_streak, temp_streak)
        else:
            temp_streak = 0
        last_date = l.date
        
    # Current Streak needs to check if it's still active (today or yesterday)
    active_streak = 0
    if asc_logs:
        # Check from end
        check_date = today
        idx = len(asc_logs) - 1
        while idx >= 0:
            l = asc_logs[idx]
            if l.completed and (l.date == check_date or l.date == check_date - timedelta(days=1)):
                active_streak += 1
                check_date = l.date - timedelta(days=1)
                idx -= 1
            else:
                break
    
    current_streak = active_streak
    total_done = sum(1 for l in logs if l.completed)
    
    # History for calendar (last 30 days)
    history = []
    for i in range(30):
        d = today - timedelta(days=i)
        log = next((l for l in logs if l.date == d), None)
        history.append({
            'date': d.strftime('%Y-%m-%d'),
            'day': d.day,
            'completed': log.completed if log else False,
            'partial': (log.value > 0 and not log.completed) if log else False
        })
        
    # Recent Activity
    recent = []
    for l in logs[:5]:
        recent.append({
            'date': l.date.strftime('%Y-%m-%d'),
            'display_date': l.date.strftime('%b %d, %A'),
            'completed': l.completed,
            'value': l.value
        })

    return jsonify({
        'id': habit.id,
        'text': habit.text,
        'target': habit.target,
        'frequency': habit.frequency,
        'current_streak': current_streak,
        'best_streak': best_streak,
        'total_done': total_done,
        'completion_rate': round((total_done / len(logs) * 100) if logs else 0),
        'history': history,
        'recent': recent
    })

@app.route('/api/toggle_task', methods=['POST'])
@login_required
def toggle_task():
    try:
        data = request.json
        tid = data.get('id')
        task = Task.query.get(tid)
        if task.user_id != current_user.id: return jsonify({'success': False})
        
        task.completed = not task.completed
        if task.completed:
            task.completed_date = date.today()
            check_new_achievements(current_user) # Check for task completion
        else:
            task.completed_date = None
            
        db.session.commit()
        return jsonify({'success': True})
    except:
        return jsonify({'success': False})

@app.route('/api/delete_habit', methods=['POST'])
@login_required
def delete_habit():
    try:
        data = request.json
        habit_id = data.get('id')
        habit = Habit.query.get_or_404(habit_id)
        if habit.user_id != current_user.id:
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403
            
        db.session.delete(habit)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Delete habit error: {e}")
        return jsonify({'success': False})

@app.route('/api/delete_task', methods=['POST'])
@login_required
def delete_task():
    try:
        data = request.json
        task_id = data.get('id')
        task = Task.query.get_or_404(task_id)
        if task.user_id != current_user.id:
            return jsonify({'success': False, 'message': 'Unauthorized'}), 403
            
        db.session.delete(task)
        db.session.commit()
        return jsonify({'success': True})
    except:
        return jsonify({'success': False})

# --- Friend API ---

@app.route('/api/search_users', methods=['POST'])
@login_required
def search_users():
    query = request.json.get('query')
    if not query: return jsonify([])
    users = User.query.filter(User.username.ilike(f'%{query}%'), User.id != current_user.id).limit(5).all()
    results = []
    for u in users:
        # Check status
        f1 = Friendship.query.filter_by(sender_id=current_user.id, receiver_id=u.id).first()
        f2 = Friendship.query.filter_by(sender_id=u.id, receiver_id=current_user.id).first()
        status = 'msg'
        if f1: status = f1.status # pending or accepted
        elif f2: status = f2.status + '_received' if f2.status == 'pending' else 'accepted'
        
        results.append({'id': u.id, 'username': u.username, 'status': status})
    return jsonify(results)

@app.route('/api/add_friend', methods=['POST'])
@login_required
def add_friend():
    target_id = request.json.get('id')
    if not Friendship.query.filter_by(sender_id=current_user.id, receiver_id=target_id).first():
        f = Friendship(sender_id=current_user.id, receiver_id=target_id, status='pending')
        db.session.add(f)
        db.session.commit()
    return jsonify({'success': True})

@app.route('/api/accept_friend', methods=['POST'])
@login_required
def accept_friend():
    target_id = request.json.get('id')
    f = Friendship.query.filter_by(sender_id=target_id, receiver_id=current_user.id).first()
    if f:
        f.status = 'accepted'
        db.session.commit()
    return jsonify({'success': True})

@app.route('/api/remove_friend', methods=['POST'])
@login_required
def remove_friend():
    target_id = request.json.get('id')
    # Check both directions
    Friendship.query.filter(
        ((Friendship.sender_id==current_user.id) & (Friendship.receiver_id==target_id)) |
        ((Friendship.sender_id==target_id) & (Friendship.receiver_id==current_user.id))
    ).delete()
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/user_details/<int:id>')
@login_required
def get_user_details(id):
    user = User.query.get_or_404(id)
    
    # Check friendship status
    status = 'none'
    if user.id != current_user.id:
        f1 = Friendship.query.filter_by(sender_id=current_user.id, receiver_id=user.id).first()
        f2 = Friendship.query.filter_by(sender_id=user.id, receiver_id=current_user.id).first()
        if f1: status = f1.status
        elif f2: status = f2.status + '_received' if f2.status == 'pending' else 'accepted'
    else:
        status = 'self'

    # Get achievements
    user_achvs = UserAchievement.query.filter_by(user_id=user.id).order_by(UserAchievement.date_earned.desc()).limit(5).all()
    achievements = []
    earned_ids = {ua.achievement_id for ua in user_achvs}
    
    for ua in user_achvs:
        ach = Achievement.query.get(ua.achievement_id)
        achievements.append({
            'title': ach.title,
            'icon': ach.icon,
            'earned': True
        })
        
    achievement_count = UserAchievement.query.filter_by(user_id=user.id).count()

    return jsonify({
        'id': user.id,
        'username': user.username,
        'join_year': '2025', # Hardcoded for MVP as created_at is missing
        'streak': user.current_streak,
        'achievement_count': achievement_count,
        'achievements': achievements,
        'status': status
    })

@app.route('/api/get_friends')
@login_required
def get_friends():
    # Complex query to get all accepted friends
    fs = Friendship.query.filter(
        ((Friendship.sender_id==current_user.id) | (Friendship.receiver_id==current_user.id)) & 
        (Friendship.status=='accepted')
    ).all()
    
    friends = []
    for f in fs:
        uid = f.receiver_id if f.sender_id == current_user.id else f.sender_id
        u = User.query.get(uid)
        friends.append({'id': u.id, 'username': u.username, 'streak': u.current_streak})
    return jsonify(friends)

@app.route('/api/get_pending_requests')
@login_required
def get_pending():
    fs = Friendship.query.filter_by(receiver_id=current_user.id, status='pending').all()
    reqs = []
    for f in fs:
        u = User.query.get(f.sender_id)
        reqs.append({'id': u.id, 'username': u.username})
    return jsonify(reqs)

# --- Logic ---

def check_global_streak(user):
    # Simplified Logic for Global Streak (All Daily Habits)
    today = date.today()
    if user.last_completed_date == today: return

    # Check daily habits only for global streak
    habits = Habit.query.filter_by(user_id=user.id, frequency='daily').all()
    if not habits: return # specific logic: if no habits, no streak? or free streak? let's say no streak increment

    all_done = True
    for h in habits:
        log = HabitLog.query.filter_by(habit_id=h.id, date=today).first()
        if not log or not log.completed:
            all_done = False
            break
    
    if all_done:
        if user.last_completed_date:
            delta = (today - user.last_completed_date).days
            if delta == 1:
                user.current_streak += 1
            elif delta > 1:
                user.current_streak = 1
        else:
             user.current_streak = 1
        user.last_completed_date = today
        db.session.commit()

def check_group_streak(shared_id):
    # Check if ALL members completed for today?
    # This is complex because "today" might not be over.
    # Usually group streaks are calculated at midnight.
    # But user wants "reset if one fails".
    # We can check "Yesterday" to be safe.
    # For MVP: We just store it. Real logic would require a Cron job or check on access.
    # For MVP: We just store it. Real logic would require a Cron job or check on access.
    pass

def init_achievements():
    defaults = [
        {'slug': 'first_habit', 'title': 'Der Anfang', 'description': 'Erstelle deine erste Gewohnheit.', 'icon': 'flag', 'condition': 'habits_created', 'threshold': 1},
        {'slug': 'first_log', 'title': 'Erster Schritt', 'description': 'Erledige eine Gewohnheit zum ersten Mal.', 'icon': 'check_circle', 'condition': 'habits_completed', 'threshold': 1},
        {'slug': 'streak_3', 'title': 'On Fire', 'description': 'Erreiche einen 3-Tage Streak.', 'icon': 'local_fire_department', 'condition': 'streak', 'threshold': 3},
        {'slug': 'streak_7', 'title': 'Wochen-Warrior', 'description': 'Ein ganzer Wochen-Streak!', 'icon': 'calendar_view_week', 'condition': 'streak', 'threshold': 7},
        {'slug': 'streak_30', 'title': 'Gewohnheitstier', 'description': '30 Tage Disziplin am Stück.', 'icon': 'workspace_premium', 'condition': 'streak', 'threshold': 30},
        {'slug': 'tasks_10', 'title': 'Taskmaster', 'description': 'Erledige 10 Aufgaben.', 'icon': 'done_all', 'condition': 'tasks_completed', 'threshold': 10},
        {'slug': 'habits_100', 'title': 'Century Club', 'description': '100 Mal eine Gewohnheit erledigt.', 'icon': 'military_tech', 'condition': 'habits_completed', 'threshold': 100},
    ]
    
    for d in defaults:
        if not Achievement.query.filter_by(slug=d['slug']).first():
            db.session.add(Achievement(
                slug=d['slug'],
                title=d['title'],
                description=d['description'],
                icon=d['icon'],
                condition_type=d['condition'],
                threshold=d['threshold']
            ))
    db.session.commit()

def check_new_achievements(user):
    # Retrieve current stats
    # 1. Habits Created
    habits_created = Habit.query.filter_by(user_id=user.id).count()
    
    # 2. Habits Completed (Total Logs)
    # Join Logic: HabitLog -> Habit (filter user_id)
    # habits_completed = HabitLog.query.join(Habit).filter(Habit.user_id == user.id, HabitLog.completed == True).count()
    # Simplified without explicit Join if backrefs work, or explicit join:
    habits_completed = db.session.query(HabitLog).join(Habit).filter(Habit.user_id == user.id, HabitLog.completed == True).count()
    
    # 3. Tasks Completed
    tasks_completed = Task.query.filter_by(user_id=user.id, completed=True).count()
    
    # 4. Current Streak
    streak = user.current_streak
    
    # Check all achievements
    all_achvs = Achievement.query.all()
    user_achvs = {ua.achievement_id for ua in UserAchievement.query.filter_by(user_id=user.id).all()}
    
    for ach in all_achvs:
        if ach.id in user_achvs:
            continue
            
        earned = False
        if ach.condition_type == 'habits_created' and habits_created >= ach.threshold: earned = True
        elif ach.condition_type == 'habits_completed' and habits_completed >= ach.threshold: earned = True
        elif ach.condition_type == 'tasks_completed' and tasks_completed >= ach.threshold: earned = True
        elif ach.condition_type == 'streak' and streak >= ach.threshold: earned = True
        
        if earned:
            db.session.add(UserAchievement(user_id=user.id, achievement_id=ach.id))
            db.session.commit()
            # Optional: Add flash message if triggered by user action
            # flash(f'🏆 Erfolg freigeschaltet: {ach.title}!')

@app.route('/manifest.json')
def manifest():
    return send_from_directory('static', 'manifest.json')
@app.route('/sw.js')
def service_worker():
    return send_from_directory('static', 'sw.js')

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        init_achievements()
        # Auto-migration for scheduled_date if missing (SQLite specific hack for MVP)
        try:
            with db.engine.connect() as con:
                con.execute(db.text("ALTER TABLE task ADD COLUMN scheduled_date DATE"))
                print("Migrated task table")
        except Exception as e:
            pass # Column likely exists
    app.run(debug=True, host='0.0.0.0', port=5000)
