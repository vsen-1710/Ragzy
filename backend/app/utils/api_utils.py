from flask import jsonify
from datetime import datetime

def api_success(data=None, message=None, status_code=200):
    """Helper function to return a success response"""
    response = {
        'success': True
    }
    
    if data is not None:
        response['data'] = data
    
    if message is not None:
        response['message'] = message
    
    return jsonify(response), status_code

def api_error(message, status_code=400):
    """Helper function to return an error response"""
    return jsonify({
        'success': False,
        'error': message
    }), status_code

def serialize_model(model, exclude=None):
    """Convert a model instance to a dictionary for API responses"""
    if exclude is None:
        exclude = []
    
    result = {}
    for column in model.__table__.columns:
        if column.name not in exclude:
            value = getattr(model, column.name)
            
            # Handle date/datetime objects
            if isinstance(value, (datetime, datetime.date)):
                value = value.isoformat()
            
            result[column.name] = value
    
    return result 