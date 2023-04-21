from flask_login import UserMixin


class User(UserMixin):
    def __init__(self, id):
        self.id = id

    def is_active(self):
        return True

    def is_anonymous(self):
        return False

    def is_authenticated(self):
        return True
