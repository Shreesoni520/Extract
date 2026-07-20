"""Flask application factory."""
from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from flask import Flask, send_from_directory

from . import config as cfg
from .db import close_db
from .auth import visitor_token, attach_visitor_cookie


def create_app() -> Flask:
    templates = Path(__file__).resolve().parent.parent / "templates"
    app = Flask(
        __name__,
        template_folder=str(templates),
        static_folder=None,
    )
    app.secret_key = cfg.SECRET_KEY
    app.config["MAX_CONTENT_LENGTH"] = cfg.MAX_UPLOAD_BYTES + (1 * 1024 * 1024)
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=14)
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

    app.teardown_appcontext(close_db)

    @app.context_processor
    def inject_globals():
        return {
            "app_name": cfg.APP_NAME,
            "url_prefix": cfg.URL_PREFIX,
            "password_min_length": cfg.PASSWORD_MIN_LENGTH,
        }

    @app.before_request
    def _ensure_visitor():
        # Touch visitor cookie on app routes
        from flask import request

        path = request.path or "/"
        if path == "/" or path.startswith(cfg.URL_PREFIX or "/"):
            visitor_token()

    @app.after_request
    def _set_visitor(response):
        return attach_visitor_cookie(response)

    # Static assets at /Extract/assets/...
    @app.route(f"{cfg.URL_PREFIX}/assets/<path:filename>")
    def extract_assets(filename: str):
        return send_from_directory(str(cfg.ASSETS_DIR), filename)

    @app.route(f"{cfg.URL_PREFIX}/favicon.ico")
    def extract_favicon():
        return send_from_directory(str(cfg.PROJECT_ROOT), "favicon.ico")

    from flask import redirect

    # So https://your-app.vercel.app/ is not a blank 404
    @app.route("/")
    def root_redirect():
        target = f"{cfg.URL_PREFIX}/" if cfg.URL_PREFIX else "/"
        return redirect(target)

    from .routes.pages import pages_bp
    from .routes.api import api_bp

    app.register_blueprint(pages_bp, url_prefix=cfg.URL_PREFIX)
    app.register_blueprint(api_bp, url_prefix=f"{cfg.URL_PREFIX}/api")

    return app
