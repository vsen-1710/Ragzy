FROM python:3.10-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project
COPY . .

# Run gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "run:app"]
