FROM python:3.10-slim

WORKDIR /app

# Copy python client dependencies
COPY requirements.txt ./

# Install python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the agent script in its folder structure to preserve relative path lookups (../config.json)
COPY agent.py ./client-python/

# Run the agent
CMD ["python", "client-python/agent.py"]
