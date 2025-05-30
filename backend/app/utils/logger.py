import logging
import os
from logging.handlers import RotatingFileHandler
from flask import current_app, has_app_context

def setup_logger(app):
    """Configure application logging"""
    log_dir = app.config.get('LOG_DIR', 'logs')
    os.makedirs(log_dir, exist_ok=True)
    
    log_level = logging.DEBUG if app.config.get('DEBUG', False) else logging.INFO
    log_format = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    
    # Configure file handler
    file_handler = RotatingFileHandler(
        os.path.join(log_dir, 'app.log'),
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=10
    )
    file_handler.setFormatter(logging.Formatter(log_format))
    file_handler.setLevel(log_level)
    
    # Configure console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter(log_format))
    console_handler.setLevel(log_level)
    
    # Add handlers to app logger
    app.logger.addHandler(file_handler)
    app.logger.addHandler(console_handler)
    app.logger.setLevel(log_level)
    
    # Replace the werkzeug logger handlers
    logging.getLogger('werkzeug').handlers = []
    logging.getLogger('werkzeug').addHandler(file_handler)
    logging.getLogger('werkzeug').addHandler(console_handler)
    
    app.logger.info("Logger initialized")

def get_logger():
    """Get the application logger, or create a default one if not in app context"""
    if has_app_context():
        return current_app.logger
    else:
        logger = logging.getLogger('personal_gpt')
        
        if not logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            ))
            logger.addHandler(handler)
            logger.setLevel(logging.INFO)
        
        return logger