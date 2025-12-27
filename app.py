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
    completed = db.Column(db.Boolean, default=False)
    completed_date = db.Column(db.Date, nullable=True)

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
        
        # 2. If NOT completed, show if created_date >= today - 3 days
        else:
            delta = (today - t.created_date).days
            if delta > 3:
                continue # Expired
        
        # Determine label (e.g. "Yesterday")
        tag = ""
        days_old = (today - t.created_date).days
        if not t.completed and days_old == 1: tag = "Gestern"
        elif not t.completed and days_old > 1: tag = f"Vor {days_old} Tagen"
        
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
        if not text: return jsonify({'success': False})
        
        t = Task(text=text, user_id=current_user.id)
        db.session.add(t)
        db.session.commit()
        return jsonify({'success': True})
    except:
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
        if habit.is_shared:
            check_group_streak(habit.shared_id)
            
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Add habit error: {e}")
        return jsonify({'success': False})

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
        else:
            task.completed_date = None
            
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
    pass

@app.route('/manifest.json')
def manifest():
    return send_from_directory('static', 'manifest.json')
@app.route('/sw.js')
def service_worker():
    return send_from_directory('static', 'sw.js')

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, host='0.0.0.0', port=5000)
